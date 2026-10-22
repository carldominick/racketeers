"use client";
import { useEffect, useRef, useState } from "react";
import type * as Three from "three";
import type { ProjectorCourt } from "../../lib/projector";
import { badmintonLines } from "../../lib/court-view";

type Props = { courts: ProjectorCourt[]; selected: number; onSelect: (court: number) => void; theme: string; flat: boolean; rotation: number; zoom: number; onFallback: () => void };
type Label = { court: number; left: number; top: number; visible: boolean; width: number };

/** Actual metre-based 3D geometry, not an image of a tennis court. Render only on change. */
export function CourtVenue({ courts, selected, onSelect, theme, flat, rotation, zoom, onFallback }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const [labelHeight, setLabelHeight] = useState(58);
  const [failed, setFailed] = useState(false);
  const signature = JSON.stringify(courts);
  useEffect(() => {
    if(flat)return;
    const cards=host.current?.parentElement?.querySelectorAll(".court-venue-label");
    if(!cards?.length)return;
    const measure=()=>setLabelHeight(Math.max(58,...Array.from(cards,card=>Math.ceil(card.getBoundingClientRect().height))));
    const observer=new ResizeObserver(measure);cards.forEach(card=>observer.observe(card));measure();
    return()=>observer.disconnect();
  }, [labels, flat]);
  useEffect(() => {
    if (flat) return;
    let disposed = false;
    let cleanup = () => {};
    const start = async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      if (disposed || !host.current) return;
      const container = host.current;
      const dark = theme !== "light";
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(theme === "black" ? 0x000000 : dark ? 0x111a23 : 0xe8ecee);
      const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 500);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.domElement.setAttribute("aria-hidden", "true");
      container.appendChild(renderer.domElement);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enablePan = false; controls.enableDamping = false;
      controls.minPolarAngle = .25; controls.maxPolarAngle = 1.25;
      controls.minDistance = 18; controls.maxDistance = 160;
      controls.minZoom = .6; controls.maxZoom = 2;
      const data: ProjectorCourt[] = JSON.parse(signature);
      const columns = Math.min(4, Math.max(1, data.length));
      const rows = Math.ceil(data.length / columns);
      const depth = rows * 18.5, width = columns * 9.4;
      const distance = Math.max(depth * 1.3, width * 1.2, 26) / zoom;
      const position = new THREE.Vector3(Math.sin(rotation) * distance, distance * .12, Math.cos(rotation) * distance);
      camera.position.copy(position); controls.target.set(0, 0, 0); controls.update();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x607886, 2.2));
      const light = new THREE.DirectionalLight(0xffffff, 2.5);
      light.position.set(-15, 38, 22); light.castShadow = true;
      light.shadow.mapSize.set(512,512); light.shadow.camera.left = -45; light.shadow.camera.right = 45;
      light.shadow.camera.top = 50; light.shadow.camera.bottom = -50;
      scene.add(light);
      const mat = (color: Three.ColorRepresentation) => new THREE.MeshStandardMaterial({ color, roughness: .9 });
      const white = mat(0xf8faf5), navy = mat(0x142c41);
      const floorMat = mat(theme === "black" ? 0x000000 : dark ? 0x1b2830 : 0xd9dedf);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(width + 7, depth + 6), floorMat);
      floor.rotation.x = -Math.PI/2; floor.position.y = -.04; floor.receiveShadow = true; scene.add(floor);
      const mesh = (group: Three.Group, geometry: Three.BufferGeometry, material: Three.Material, x: number, y: number, z: number) => {
        const object = new THREE.Mesh(geometry, material); object.position.set(x,y,z); object.castShadow = true; object.receiveShadow = true; group.add(object); return object;
      };
      let textures: Three.Texture[] = [];
      const contextLost = (event: Event) => { event.preventDefault(); if(!disposed){setFailed(true);onFallback();} };
      renderer.domElement.addEventListener("webglcontextlost",contextLost);
      const disposeScene = () => {
        scene.traverse(object=>{const item=object as Three.Mesh;if(item.geometry)item.geometry.dispose();if(item.material){for(const material of Array.isArray(item.material)?item.material:[item.material])material.dispose();}});
        textures.forEach(texture=>texture.dispose());
        renderer.domElement.removeEventListener("webglcontextlost",contextLost);
        controls.dispose();renderer.dispose();renderer.domElement.remove();
      };
      cleanup=disposeScene;
      const loader = new THREE.TextureLoader();
      textures = await Promise.all([loader.loadAsync("/court-player-white.png"),loader.loadAsync("/court-player-navy.png")]);
      textures.forEach(texture=>{texture.colorSpace=THREE.SRGBColorSpace;});
      if(disposed){disposeScene();return;}
      const player = (court: Three.Group, x: number, z: number, back: boolean) => {
        const texture = textures[back ? 1 : 0];
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false,alphaTest:.03}));
        sprite.center.set(.5,.08);sprite.scale.set(1.45,2.18,1);sprite.position.set(x,.05,z);
        court.add(sprite);
      };
      const anchors: { court: number; point: Three.Vector3 }[] = [];
      const groups: Three.Group[] = [];
      data.forEach((court,index) => {
        const group = new THREE.Group(); group.userData.court = court.court;
        const x = (index % columns - (columns-1)/2)*9.4, z = (Math.floor(index/columns)-(rows-1)/2)*18.5;
        group.position.set(x,0,z); scene.add(group);
        groups.push(group);
        if(court.court === selected) mesh(group,new THREE.BoxGeometry(6.65,.045,13.95),mat(0xc8ed39),0,-.005,0);
        const green = mat(court.status === "available" ? 0x638e7b : court.status === "reserved" ? 0x6c8464 : 0x137b68);
        mesh(group,new THREE.BoxGeometry(6.3,.04,13.6),green,0,.025,0);
        badmintonLines.forEach(([x1,z1,x2,z2]) => {
          const line=mesh(group,new THREE.BoxGeometry(x1===x2?.04:Math.abs(x2-x1)+.04,.015,z1===z2?.04:Math.abs(z2-z1)+.04),white,(x1+x2)/2,.055,(z1+z2)/2);
          line.castShadow=false;
        });
        for(const side of [-1,1]) {
          mesh(group,new THREE.CylinderGeometry(.045,.045,1.55,8),navy,side*3.05,.815,0);
          mesh(group,new THREE.BoxGeometry(.35,.06,.45),navy,side*3.05,.07,0);
        }
        const net = new THREE.LineBasicMaterial({color: dark?0xd0dada:0x334653,transparent:true,opacity:.55});
        // Mesh extends only from .79m to1.55m: an open gap beneath a badminton net.
        const points: Three.Vector3[] = [];
        for(let x=-3.05;x<=3.051;x+=.12) points.push(new THREE.Vector3(x,.84,0),new THREE.Vector3(x,1.60,0));
        for(let y=.84;y<=1.601;y+=.08) points.push(new THREE.Vector3(-3.05,y,0),new THREE.Vector3(3.05,y,0));
        group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),net));
        mesh(group,new THREE.BoxGeometry(6.1,.035,.025),white,0,1.60,0);
        if(court.court===selected && court.status === "in_play" && court.game) {
          const countA=Math.min(2,court.game.playersA.length),countB=Math.min(2,court.game.playersB.length);
          for(let i=0;i<countA;i++)player(group,countA===1?0:i===0?-1.4:1.4,3.1,false);
          for(let i=0;i<countB;i++)player(group,countB===1?0:i===0?-1.4:1.4,-3.1,true);
        }
        anchors.push({court:court.court,point:new THREE.Vector3(x,.05,z+8.05)});
      });
      const render = () => {
        if(disposed)return;
        const w=container.clientWidth,h=container.clientHeight;
        if(!w || !h)return;
        const cellW=w/columns,cellH=h/rows,sceneH=Math.max(30,cellH-labelHeight-8);
        // Keep full names readable; short windows use the scrollable list instead of overlapping rows.
        if(cellH<labelHeight+38){onFallback();return;}
        renderer.setScissorTest(true);
        // One WebGL context, independently fitted views: labels never collide during rotation.
        groups.forEach(group=>{group.visible=false;});
        groups.forEach((group,index)=>{
          group.visible=true;
          renderer.shadowMap.enabled = data[index].court === selected;
          const view=camera.clone();view.position.copy(camera.position).add(group.position);view.lookAt(group.position.clone().add(new THREE.Vector3(0,.3,0)));
          view.left=-cellW/sceneH;view.right=cellW/sceneH;view.top=1;view.bottom=-1;view.zoom=1;view.updateProjectionMatrix();view.updateMatrixWorld();
          let extent=0;
          const bounds=[...[-3.5,3.5].flatMap(x=>[-7.1,7.1].map(z=>new THREE.Vector3(x,0,z))),new THREE.Vector3(0,1.6,0),new THREE.Vector3(0,1.8,3.1),new THREE.Vector3(0,1.8,-3.1)];
          for(const corner of bounds){const point=corner.add(group.position).project(view);extent=Math.max(extent,Math.abs(point.x),Math.abs(point.y));}
          view.zoom=zoom*camera.zoom/(extent*1.1);view.updateProjectionMatrix();
          const left=(index%columns)*cellW,top=Math.floor(index/columns)*cellH;
          renderer.setViewport(left,h-top-sceneH,cellW,sceneH);renderer.setScissor(left,h-top-sceneH,cellW,sceneH);renderer.render(scene,view);
          group.visible=false;
        });
        groups.forEach(group=>{group.visible=true;});
        setLabels(anchors.map((a,index)=>({court:a.court,left:(index%columns+.5)*cellW,top:Math.floor(index/columns)*cellH+sceneH+3,visible:true,width:Math.max(120,cellW-18)})));
      };
      const resize = () => {
        renderer.setSize(container.clientWidth,Math.max(1,container.clientHeight));render();
      };
      const observer=new ResizeObserver(resize);observer.observe(container);
      controls.addEventListener("change",render);
      let down=[0,0];
      const pointerDown=(event:PointerEvent)=>{down=[event.clientX,event.clientY];};
      const pointerUp=(event:PointerEvent)=>{
        if(Math.hypot(event.clientX-down[0],event.clientY-down[1])>5)return;
        const bounds=renderer.domElement.getBoundingClientRect();
        const column=Math.floor((event.clientX-bounds.left)/bounds.width*columns),row=Math.floor((event.clientY-bounds.top)/bounds.height*rows);
        const court=data[row*columns+column];if(court)onSelect(court.court);
      };
      renderer.domElement.addEventListener("pointerdown",pointerDown);renderer.domElement.addEventListener("pointerup",pointerUp);
      resize();
      cleanup=()=>{
        observer.disconnect();controls.dispose();renderer.domElement.removeEventListener("pointerdown",pointerDown);renderer.domElement.removeEventListener("pointerup",pointerUp);
        disposeScene();
      };
      if(disposed)cleanup();
    };
    void start().catch(()=>{ if(!disposed){cleanup();setFailed(true);onFallback();} });
    return()=>{disposed=true;cleanup();};
  }, [signature, selected, theme, flat, rotation, zoom, labelHeight, onSelect, onFallback]);
  const status=(court:ProjectorCourt)=>court.status.replace("_"," ");
  const names=(players:string[])=>players.join(" / ");
  const card=(court:ProjectorCourt,label?:Label)=><button key={court.court} type="button" aria-pressed={court.court===selected} className={`court-venue-label ${court.court===selected?"selected":""}`} style={label?{left:label.left,top:label.top,width:label.width,visibility:label.visible?"visible":"hidden"}:undefined} onClick={()=>onSelect(court.court)}><span className="court-venue-number">{String(court.court).padStart(2,"0")}</span><span className={`court-status ${court.status}`}>{status(court)}</span>{court.game?<span className="court-venue-pairs"><span>{names(court.game.playersA)}<b>{court.status==="reserved"?"–":court.game.scoreA}</b></span><span>{names(court.game.playersB)}<b>{court.status==="reserved"?"–":court.game.scoreB}</b></span></span>:<span className="court-venue-pairs">No game assigned</span>}</button>;
  return <section className={`court-venue ${flat?"flat":"spatial"}`} aria-label="Court availability and games">{failed&&<p role="status">3D is unavailable on this device. All courts are available in the 2D list.</p>}{!flat&&<div ref={host} className="court-venue-canvas"/>}<div className="court-venue-labels">{flat?courts.map(c=>card(c)):labels.map(label=>{const court=courts.find(c=>c.court===label.court);return court?card(court,label):null;})}</div></section>;
}
