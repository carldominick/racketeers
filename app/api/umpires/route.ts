import { handlers } from "../state/route";

export const GET = (request: Request) => handlers.UMPIRE(request);
export const POST = (request: Request) => handlers.UMPIRE(request);
