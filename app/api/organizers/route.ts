import { handleAccounts } from '../../../lib/organizer-accounts';
async function handle(request: Request) {
  const { env } = await import('cloudflare:workers');
  return handleAccounts(request, env.DB);
}
export const GET = handle;
export const POST = handle;
