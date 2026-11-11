/** Browser-only disposable storage. No live database, bucket or network fallback. */
import { createStateHandlers } from "./state-handlers";
import { handlePaymentProof, handlePaymentSettings } from "./payment-proof-server";
import { handlePaymentDetails } from "./payment-details-server";
import { handleSponsors } from "./sponsor-server";
import { courtViewSnapshot } from "./court-view";
import { demoFixture } from "./demo-fixture";

type Row = { group_id: string; reference_key: string; payload: string; proof_version: string; revision: number; updated_at: string };
export async function createDemoRuntime(expiresAt: number, receipt?: Uint8Array) {
  const state = await demoFixture();
  let current = { revision: 1, payload: JSON.stringify(state), updated_at: state.updatedAt };
  let settings = JSON.stringify({ bankName: "Demo bank (practice only)", accountName: "Practice only", accountNumber: "0000000000", instructions: "Use fictional information and sample images only. No money is collected in this demo." });
  const reviews = new Map<string, Row>();
  const sponsors = new Map<string, {id: string; name: string; created_at: string}>();
  const objects = new Map<string, { bytes: Uint8Array; uploaded: Date; etag: string }>();
  const blobs = new Set<string>();
  const assets = new Map<string, {etag: string; url: string}>();
  let closed = false;
  const blobUrl = (blob: Blob) => { const url = URL.createObjectURL(blob); blobs.add(url); return url; };
  const db = { prepare(sql: string) {
    const bind = (...v: unknown[]) => ({
      async first<T>(): Promise<T | null> {
        let result: unknown = null;
        if (sql.includes("FROM tournament_state")) result = current;
        else if (sql.includes("FROM payment_settings")) result = { payload: settings };
        else if (sql.includes("FROM payment_receipt_details")) result = sql.includes("reference_key =") ? [...reviews.values()].find(r => r.reference_key === v[0] && !v.slice(1).includes(r.group_id)) : [...reviews.values()].filter(r => v.includes(r.group_id)).sort((a,b) => b.updated_at.localeCompare(a.updated_at))[0];
        else if (sql.includes("FROM sponsor_images")) result = sponsors.get(String(v[0]));
        else throw new Error("Unsupported demo read");
        return result ? structuredClone(result) as T : null;
      },
      async run() {
        let changes = 1;
        if (sql.startsWith("CREATE")) return { meta: { changes: 0 } };
        if (sql.startsWith("UPDATE tournament_state")) {
          if (v[4] !== current.revision) changes = 0;
          else current = { revision: Number(v[0]), payload: String(v[1]), updated_at: String(v[2]) };
        } else if (sql.startsWith("INSERT INTO payment_settings")) settings = String(v[1]);
        else if (sql.startsWith("INSERT INTO payment_receipt_details")) {
          const id = String(v[5]); if (reviews.has(id)) changes = 0;
          else reviews.set(id, { group_id:id, reference_key:String(v[0]), payload:String(v[1]), proof_version:String(v[2]), revision:Number(v[3]), updated_at:String(v[4]) });
        } else if (sql.startsWith("UPDATE payment_receipt_details")) {
          const id = String(v[5]); if (reviews.get(id)?.revision !== v[6]) changes = 0;
          else reviews.set(id, { group_id:id, reference_key:String(v[0]), payload:String(v[1]), proof_version:String(v[2]), revision:Number(v[3]), updated_at:String(v[4]) });
        } else if (sql.startsWith("INSERT INTO sponsor_images")) sponsors.set(String(v[0]), {id:String(v[0]),name:String(v[1]),created_at:String(v[2])});
        else if (sql.startsWith("DELETE FROM sponsor_images")) sponsors.delete(String(v[0]));
        else throw new Error("Unsupported demo write");
        return { meta: { changes } };
      },
    });
    return { bind, run: () => bind().run(), all: async <T>() => ({ results: [...sponsors.values()].map(row => ({...row}) as T) }) };
  } };
  const bucket = {
    head: async (key: string) => { const value = objects.get(key); return value ? {size:value.bytes.length, uploaded:value.uploaded, etag:value.etag} : null; },
    get: async (key: string) => { const value = objects.get(key); return value ? {size:value.bytes.length, uploaded:value.uploaded, etag:value.etag, body:new Blob([Uint8Array.from(value.bytes)]).stream()} : null; },
    put: async (key: string, value: Uint8Array | ReadableStream<Uint8Array>) => {
      const bytes = value instanceof Uint8Array ? Uint8Array.from(value) : new Uint8Array(await new Response(value).arrayBuffer());
      objects.set(key, {bytes,uploaded:new Date(),etag:crypto.randomUUID()});
    },
    delete: async (key: string) => { objects.delete(key); },
  };
  const env = { DB:db, PAYMENT_PROOFS:bucket };
  const handlers = createStateHandlers({ database: async () => db, initialPin: async () => undefined });
  if (receipt) for (const slot of [1,2,3]) await bucket.put(slot === 1 ? "payments/groups/DEMO-PAYMENT-1/DEMO-PAYMENT-1.png" : `payments/groups/DEMO-PAYMENT-1/DEMO-PAYMENT-1.png/photos/${slot}.png`, receipt);
  const assetUrl = (path: string) => {
    if (closed || Date.now() >= expiresAt) return "";
    const url = new URL(path, "https://demo.invalid");
    const key = url.pathname === "/api/payment-settings" ? "payment-instructions/qr.png" : url.pathname === "/api/sponsors" ? `sponsors/${url.searchParams.get("image")}.png` : "";
    const image = objects.get(key);
    if (!image) return "";
    if (assets.get(key)?.etag === image.etag) return assets.get(key)!.url;
    const value = {etag:image.etag,url:blobUrl(new Blob([Uint8Array.from(image.bytes)], {type:"image/png"}))};
    assets.set(key,value);return value.url;
  };
  const send: typeof globalThis.fetch = async (input, init) => {
    if (closed || Date.now() >= expiresAt) return Response.json({error:"Demo session expired. Reload and sign in again."},{status:401});
    const request = new Request(input instanceof Request ? input : new URL(String(input), "https://demo.invalid"), init);
    if (request.signal.aborted) throw new DOMException("Aborted", "AbortError");
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/state") {
        const handler = handlers[request.method as keyof typeof handlers];
        return handler ? await handler(request) : Response.json({error:"Method not allowed"},{status:405});
      }
      if (url.pathname === "/api/payment-proof") {
        if (url.searchParams.has("export-links")) {
          const response = await handlePaymentProof(request,env);
          if (!response.ok) return response;
          const data = await response.json();
          for (const id of Object.keys(data.links)) {
            const metadata = await handlePaymentProof(new Request(`https://demo.invalid/api/payment-proof?registrationId=${encodeURIComponent(id)}&metadata=1`,{headers:request.headers}),env);
            const {photos} = await metadata.json();
            const images: string[] = [];
            for (const photo of photos) {
              const image = await handlePaymentProof(new Request(`https://demo.invalid/api/payment-proof?registrationId=${encodeURIComponent(id)}&slot=${photo.slot}`,{headers:request.headers}),env);
              images.push(`<img style="max-width:100%" alt="Demo payment photo ${photo.slot}" src="${blobUrl(await image.blob())}">`);
            }
            data.links[id] = blobUrl(new Blob([`<!doctype html><title>Demo payment photos</title><h1>Demo photos: available until this tab closes</h1>${images.join("")}`],{type:"text/html"}));
          }
          return Response.json(data);
        }
        return handlePaymentProof(request,env);
      }
      if (url.pathname === "/api/payment-settings") return handlePaymentSettings(request,env);
      if (url.pathname === "/api/payment-details") return handlePaymentDetails(request,env);
      if (url.pathname === "/api/sponsors") {
        const response = await handleSponsors(request,env);
        if (response.ok && !url.searchParams.has("image")) {
          const data = await response.json();
          if (data.images) data.images = data.images.map((image: {url: string}) => ({...image,url:assetUrl(image.url)}));
          if (data.image) data.image.url = assetUrl(data.image.url);
          return Response.json(data,{status:response.status});
        }
        return response;
      }
      if (url.pathname === "/api/courts") return Response.json(courtViewSnapshot(JSON.parse(current.payload),true));
      return Response.json({error:"This action is unavailable in the isolated demo."},{status:404});
    } catch { return Response.json({error:"The demo action failed. Reset the demo to start again."},{status:500}); }
  };
  return { send, assetUrl, close() { closed=true;objects.clear();reviews.clear();sponsors.clear();assets.clear();for(const url of blobs)URL.revokeObjectURL(url);blobs.clear(); } };
}
