import { providers } from "@/server/providers";
import { json } from "@/server/http";

/** The off-ramps this deployment can use, and their currencies. */
export async function GET() {
  return json(
    providers.map((p) => {
      const reason = p.unavailableReason();
      return {
        id: p.id,
        label: p.label,
        mock: p.mock,
        route: p.route,
        available: reason === null,
        unavailableReason: reason,
        currencies: reason === null ? p.currencies() : [],
      };
    }),
  );
}
