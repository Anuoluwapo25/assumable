// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {TroveAccount} from "../src/TroveAccount.sol";
import {TroveMarket} from "../src/TroveMarket.sol";
import {TrovePositions} from "../src/TrovePositions.sol";
import {IAssetsBridge} from "../src/interfaces/IAssetsBridge.sol";
import {IBorrowerOperations} from "../src/interfaces/IBorrowerOperations.sol";
import {IPoolRouter} from "../src/interfaces/IPoolRouter.sol";
import {IPriceFeed} from "../src/interfaces/IPriceFeed.sol";
import {ITroveManager} from "../src/interfaces/ITroveManager.sol";
import {CashOutModule} from "../src/cashout/CashOutModule.sol";
import {CashOutOrder} from "../src/cashout/IOfframpAdapter.sol";
import {DirectMUSDAdapter} from "../src/cashout/DirectMUSDAdapter.sol";
import {SwapBridgeAdapter} from "../src/cashout/SwapBridgeAdapter.sol";
import {DeployCashOut} from "../script/DeployCashOut.s.sol";
import {MockAssetsBridge} from "./mocks/MockAssetsBridge.sol";

/// @notice Cash Out against the real MUSD system, the real MUSD/mUSDC pool and
///         router, and real mUSDC, on a Mezo testnet fork. Two chain precompiles
///         can't run in Foundry's EVM and are stood in for: the BTC price
///         oracle (pinned to the live price) and AssetsBridge (a mock that burns
///         the real mUSDC with `burnFrom`, as the precompile does).
///
///   MEZO_FORK=1 MEZO_FORK_BLOCK=<recent block> forge test --match-contract CashOutFork
contract CashOutForkTest is Test {
    DeployCashOut.Config c;
    IERC20 musd;
    IERC20 musdc;
    TrovePositions positions;
    TroveMarket market;
    CashOutModule module;
    DirectMUSDAdapter direct;
    SwapBridgeAdapter swapBridge;
    MockAssetsBridge bridge;

    address user = makeAddr("user");
    address provider = makeAddr("provider");
    address signer;
    uint256 signerKey;

    function setUp() public {
        if (!vm.envOr("MEZO_FORK", false)) vm.skip(true);
        uint256 forkBlock = vm.envOr("MEZO_FORK_BLOCK", uint256(0));
        if (forkBlock == 0) vm.createSelectFork("mezo_testnet");
        else vm.createSelectFork("mezo_testnet", forkBlock);

        (c,) = new DeployCashOut().load(block.chainid);
        musd = IERC20(c.musd);
        musdc = IERC20(c.musdc);
        (signer, signerKey) = makeAddrAndKey("order signer");

        bytes memory live = vm.rpc(
            "eth_call",
            string.concat(
                '[{"to":"',
                vm.toString(c.priceFeed),
                '","data":"',
                vm.toString(abi.encodeWithSelector(IPriceFeed.fetchPrice.selector)),
                '"},"latest"]'
            )
        );
        vm.mockCall(
            c.priceFeed,
            abi.encodeWithSelector(IPriceFeed.fetchPrice.selector),
            abi.encode(abi.decode(live, (uint256)))
        );

        vm.etch(c.assetsBridge, type(MockAssetsBridge).runtimeCode);
        bridge = MockAssetsBridge(c.assetsBridge);
        bridge.setMinBridgeOutAmount(c.musdc, 10e6); // testnet's live minimum

        // A fresh Assumable, so the test doesn't depend on deployed state.
        string memory json =
            vm.readFile(string.concat(vm.projectRoot(), "/config/mezo-testnet.json"));
        TroveAccount impl = new TroveAccount(
            IBorrowerOperations(vm.parseJsonAddress(json, ".musd.borrowerOperations")),
            ITroveManager(vm.parseJsonAddress(json, ".musd.troveManager")),
            musd
        );
        positions = new TrovePositions(address(impl));
        market = new TroveMarket(
            positions,
            musd,
            ITroveManager(vm.parseJsonAddress(json, ".musd.troveManager")),
            IPriceFeed(c.priceFeed)
        );
        module = new CashOutModule(
            positions, market, IPriceFeed(c.priceFeed), musd, signer, address(this)
        );
        direct = new DirectMUSDAdapter(address(module), musd, address(this));
        swapBridge = new SwapBridgeAdapter(
            address(module),
            musd,
            musdc,
            IPoolRouter(c.router),
            c.poolFactory,
            IAssetsBridge(c.assetsBridge),
            c.minBridgeOut,
            c.maxMusdIn,
            address(this)
        );
        module.setAdapter(address(direct), true);
        module.setAdapter(address(swapBridge), true);

        vm.deal(user, 1 ether);
    }

    function _order(address adapter, uint256 tokenId, uint256 amount, uint256 minOut, bytes32 tag)
        internal
        view
        returns (CashOutOrder memory o, bytes memory sig)
    {
        o = CashOutOrder({
            orderId: tag,
            tokenId: tokenId,
            owner: user,
            adapter: adapter,
            depositAddress: provider,
            musdAmount: amount,
            minOut: minOut,
            expiry: uint64(block.timestamp + 10 minutes)
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, module.hashOrder(o));
        sig = abi.encodePacked(r, s, v);
    }

    function _quoteUsdc(uint256 musdIn) internal view returns (uint256) {
        IPoolRouter.Route[] memory routes = new IPoolRouter.Route[](1);
        routes[0] = IPoolRouter.Route(c.musd, c.musdc, true, c.poolFactory);
        return IPoolRouter(c.router).getAmountsOut(musdIn, routes)[1];
    }

    function test_fork_firstCashOutThenRouteAThenRepay() public {
        // A new user's first cash-out: open with 0.1 BTC at MUSD's minimum loan,
        // and send 300 MUSD through the real pool and (stand-in) bridge.
        uint256 quoted = _quoteUsdc(300e18);
        uint256 minOut = quoted * 99 / 100;
        (CashOutOrder memory o, bytes memory sig) =
            _order(address(swapBridge), 0, 300e18, minOut, "first");

        vm.prank(user);
        (uint256 id, uint256 delivered) =
            module.openAndCashOut{value: 0.1 ether}(o, sig, 1_800e18, address(0), address(0));

        assertEq(positions.ownerOf(id), user);
        assertEq(delivered, quoted, "delivered what the real pool quoted");
        assertGe(delivered, 10e6);
        assertEq(bridge.unlockCount(), 1);
        (address token, uint256 amount,, bytes memory recipient, address sender) = bridge.unlocks(0);
        assertEq(token, c.musdc);
        assertEq(amount, delivered);
        assertEq(recipient, abi.encodePacked(provider));
        assertEq(sender, address(swapBridge));
        assertEq(musd.balanceOf(user), 1_500e18, "the rest of MUSD's minimum loan");

        TroveAccount account = positions.accountOf(id);
        ITroveManager tm = ITroveManager(
            vm.parseJsonAddress(
                vm.readFile(string.concat(vm.projectRoot(), "/config/mezo-testnet.json")),
                ".musd.troveManager"
            )
        );
        assertEq(uint8(tm.getTroveStatus(address(account))), uint8(ITroveManager.Status.active));

        // Route A on the same position: MUSD straight to the provider.
        (o, sig) = _order(address(direct), id, 200e18, 200e18, "second");
        vm.startPrank(user);
        positions.setApprovalForAll(address(module), true);
        module.cashOut(o, sig, address(0), address(0));
        vm.stopPrank();
        assertEq(musd.balanceOf(provider), 200e18);

        // Pay back. MUSD won't let a partial repayment take net debt under its
        // 1,800 MUSD minimum, so the most this Trove can repay now is what it
        // borrowed above that (the Route A draw here); below it, only closing.
        vm.startPrank(user);
        musd.approve(address(module), type(uint256).max);
        (, uint256 debtBefore) = account.position();
        uint256 repayable = debtBefore - 200e18 - 1_800e18;
        vm.expectRevert("BorrowerOps: Trove's net debt must be greater than minimum");
        module.repay(id, repayable + 1e18, "too much", address(0), address(0));

        module.repay(id, 150e18, "onramp", address(0), address(0));
        vm.stopPrank();
        (, uint256 debtAfter) = account.position();
        assertApproxEqAbs(debtBefore - debtAfter, 150e18, 1e15);
        assertEq(musd.allowance(address(module), address(account)), 0);

        assertEq(musd.balanceOf(address(module)), 0);
        assertEq(musd.balanceOf(address(swapBridge)), 0);
        assertEq(musdc.balanceOf(address(swapBridge)), 0);
        assertEq(musd.allowance(address(swapBridge), c.router), 0);
        assertEq(musdc.allowance(address(swapBridge), c.assetsBridge), 0);
    }

    function test_fork_slippageAgainstRealPool() public {
        vm.startPrank(user);
        (uint256 id,) = _openPlain();
        vm.stopPrank();
        uint256 quoted = _quoteUsdc(300e18);
        (CashOutOrder memory o, bytes memory sig) =
            _order(address(swapBridge), id, 300e18, quoted + 1, "greedy");
        vm.prank(user);
        vm.expectRevert(IPoolRouter.InsufficientOutputAmount.selector);
        module.cashOut(o, sig, address(0), address(0));
    }

    function test_fork_ltvCapAgainstRealPrice() public {
        vm.startPrank(user);
        (uint256 id,) = _openPlain();
        vm.stopPrank();
        // 0.1 BTC is about $8k; another 2,000 MUSD would leave ~50% LTV.
        (CashOutOrder memory o, bytes memory sig) =
            _order(address(direct), id, 2_000e18, 0, "toomuch");
        vm.prank(user);
        vm.expectPartialRevert(CashOutModule.LtvAboveMax.selector);
        module.cashOut(o, sig, address(0), address(0));
    }

    function _openPlain() internal returns (uint256 id, TroveAccount account) {
        (id, account) = positions.openPosition{value: 0.1 ether}(1_800e18, address(0), address(0));
        positions.setApprovalForAll(address(module), true);
    }
}
