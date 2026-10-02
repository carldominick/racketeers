import React from 'react';
import {createRoot} from 'react-dom/client';
import Home from '../app/page';
import '../app/globals.css';
const viewport = new URLSearchParams(location.search).get('viewport');
const width = Number(viewport);
const height = Number(new URLSearchParams(location.search).get('height')) || (width === 390 ? 844 : width === 1440 ? 1024 : 1194);
const scale = width === 1440 ? .85 : 1;
createRoot(document.getElementById('root')!).render(viewport ? <div style={{width:width*scale,height:height*scale,margin:'0 auto'}}><iframe title="Responsive registration preview" src={`/?frame=1&role=${new URLSearchParams(location.search).get('role') || ''}`}  style={{display:'block',border:0,width,height,transform:`scale(${scale})`,transformOrigin:'top left'}} /></div> : <Home />);
