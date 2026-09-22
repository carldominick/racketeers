import assert from "node:assert/strict";
import test from "node:test";

test("renders the Racketeers page", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), /Racketeers/);
});

test("built Worker blocks overseas HTML, assets, and APIs before accessing data", async () => {
  const { default: worker } = await import(new URL('../dist/server/index.js', import.meta.url));
  for (const path of ['/', '/api/state', '/assets/example.js', '/_vinext/image']) {
    const request = new Request('https://racketeers.example'+path, {headers:{'cf-ipcountry':'PH'}});
    Object.defineProperty(request, 'cf', {value:{country:'US'}});
    const response = await worker.fetch(request, {}, {});
    assert.equal(response.status,403);
    assert.equal(response.headers.get('cache-control'),'private, no-store');
  }
});
test("built Worker serves Philippine page and static assets after geography check", async () => {
  const {default:worker}=await import(new URL('../dist/server/index.js',import.meta.url));
  const {readdir}=await import('node:fs/promises');
  const assets=await readdir(new URL('../dist/client/assets/',import.meta.url));
  const asset=assets.find(name=>name.endsWith('.js'));
  for(const path of ['/',`/assets/${asset}`]) {
    const request=new Request('https://racketeers.example'+path,{headers:{accept:path==='/'?'text/html':'*/*'}});
    Object.defineProperty(request,'cf',{value:{country:'PH'}});
    const response=await worker.fetch(request,{ASSETS:{fetch:async()=>new Response('asset-content')}},{waitUntil(){},passThroughOnException(){}});
    assert.equal(response.status,200);
    assert.match(await response.text(),path==='/'?/Racketeers/:/asset-content/);
  }
});
