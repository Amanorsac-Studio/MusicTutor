import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines, BookOpen, Camera, ChevronDown, Circle, Clock3, Download,
  FileVideo, FolderOpen, Gauge, Headphones, Keyboard, Library, Lock,
  Mic2, MonitorPlay, Music2, Pause, Piano, Play, Plus, Radio, RotateCcw,
  Save, Settings, SlidersHorizontal, Sparkles, Square, Upload, Video,
  Volume2, WandSparkles, Wifi, X, Zap, Minus, Maximize2,
} from 'lucide-react';
import { desktopRecorder, pianoEngine } from './services/desktopEngine';

declare global {
  interface Window {
    pianoTutorDesktop?: { isDesktop: boolean; minimize: () => void; maximize: () => void; close: () => void; saveRecording: (bytes: ArrayBuffer, name: string) => Promise<string>; saveProject: (project: unknown) => Promise<string>; listProjects:()=>Promise<Array<{filePath:string;name:string;savedAt:string;scene:string}>>; listRecordings:()=>Promise<Array<{name:string;filePath:string;size:number;createdAt:string}>>;openPath:(target:string)=>Promise<string>;openLibraryFolder:(kind:'projects'|'recordings')=>Promise<string>;loadSettings:()=>Promise<Record<string,unknown>>;saveSettings:(value:unknown)=>Promise<string> };
  }
}

type Workspace = 'Studio' | 'Devices' | 'Mixer' | 'Library' | 'Settings';
type Scene = { name: string; subtitle: string; color: string };

const scenes: Scene[] = [
  { name: 'Default Lesson', subtitle: 'Face + Keys + Hands', color: '#178bff' },
  { name: 'Clean Blue', subtitle: 'Title + Hands', color: '#1568c9' },
  { name: 'Dark Studio', subtitle: 'Face + Keys', color: '#714825' },
  { name: 'Teaching Board', subtitle: 'Board + Face + VMK', color: '#386478' },
];

const pianoNotes = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const blackOffsets = new Set([1,3,6,8,10]);
const channels = [
  { name: 'Mic 1', detail: 'USB Audio · Mono', level: 72, color: '#38dfa3' },
  { name: 'Mic 2', detail: 'Not connected', level: 0, color: '#607184' },
  { name: 'Keyboard 1', detail: 'Input 3–4 · Stereo', level: 57, color: '#38dfa3' },
  { name: 'Keyboard 2', detail: 'Input 5–6 · Stereo', level: 28, color: '#38dfa3' },
  { name: 'MIDI Instrument', detail: 'Acoustic Grand', level: 64, color: '#1ea4ff' },
];

function useDeviceCatalog() {
  const [catalog,setCatalog]=useState({audioInputs:[] as {id:string,name:string}[],audioOutputs:[] as {id:string,name:string}[],videoInputs:[] as {id:string,name:string}[],midiInputs:[] as {id:string,name:string}[],midiOutputs:[] as {id:string,name:string}[]});
  const refresh=async(requestPermission=false)=>{
    if(requestPermission){try{const permissionStream=await navigator.mediaDevices.getUserMedia({audio:true,video:true});permissionStream.getTracks().forEach(track=>track.stop())}catch{try{const audioOnly=await navigator.mediaDevices.getUserMedia({audio:true});audioOnly.getTracks().forEach(track=>track.stop())}catch{/* enumerate all endpoints still available */}}}
    const devices=await navigator.mediaDevices.enumerateDevices(); const midi=await pianoEngine.getMidiDevices();
    let ai=0,ao=0,vi=0;setCatalog({
      audioInputs:devices.filter(d=>d.kind==='audioinput').map(d=>({id:d.deviceId,name:d.label||`Audio input ${++ai}`})),
      audioOutputs:devices.filter(d=>d.kind==='audiooutput').map(d=>({id:d.deviceId,name:d.label||`Audio output ${++ao}`})),
      videoInputs:devices.filter(d=>d.kind==='videoinput').map(d=>({id:d.deviceId,name:d.label||`Camera ${++vi}`})),
      midiInputs:midi.inputs,midiOutputs:midi.outputs,
    });
  };
  useEffect(()=>{refresh(false).catch(()=>{});const changed=()=>refresh(false).catch(()=>{});navigator.mediaDevices?.addEventListener('devicechange',changed);return()=>navigator.mediaDevices?.removeEventListener('devicechange',changed)},[]);
  return {catalog,refresh};
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v:boolean)=>void; label: string }) {
  return <button className={`toggle ${value ? 'on' : ''}`} aria-label={label} aria-pressed={value} onClick={() => onChange(!value)}><span /></button>;
}

function Meter({ level, color='#39dfa0' }: { level:number; color?:string }) {
  return <div className="meter"><i style={{ width: `${level}%`, background: color }} /></div>;
}

function SelectBox({ children, options, value:controlled, onChange }: { children: React.ReactNode; options?: string[]; value?:string; onChange?:(value:string)=>void }) {
  const initial=String(children);
  const known:Record<string,string[]>={
    'Microphone (USB Audio)':['Microphone (USB Audio)','Default microphone','Microphone array','No input'],
    'Speakers (Realtek Audio)':['Speakers (Realtek Audio)','Default audio output','Headphones','No monitoring'],
    'MIDI Keyboard (USB)':['MIDI Keyboard (USB)','All MIDI inputs','Computer keyboard','Visualization only'],
    'Built-in Grand Piano':['Built-in Grand Piano','Warm Grand','Bright Piano','Rhodes EP','Visualization only'],
    'Inter':['Inter','Segoe UI','Arial','Georgia'],
    '36 px':['24 px','30 px','36 px','42 px','54 px'],
    'Default camera':['Default camera','Integrated camera','USB camera','Capture card'],
    '1920 × 1080 · 30fps':['1280 × 720 · 30fps','1920 × 1080 · 30fps','1920 × 1080 · 60fps','3840 × 2160 · 30fps'],
    'Mono':['Mono','Input 1','Input 2'],
    'Stereo':['Stereo','Inputs 1–2','Inputs 3–4','Inputs 5–6'],
    'Web MIDI / USB Keyboard':['Web MIDI / USB Keyboard','All MIDI devices','Computer keyboard'],
    'Default audio output':['Default audio output','Speakers','Headphones'],
    'Mic 1':['Mic 1','Mic 2','Mic bus'],
    'Instrument bus':['Instrument bus','Keyboard 1','Keyboard 2','MIDI instrument'],
    '1080p · 30 fps':['720p · 30 fps','1080p · 30 fps','1080p · 60 fps','4K · 30 fps'],
    'H.264 · Auto':['H.264 · Auto','WebM · VP9','H.264 · Hardware','H.264 · Software'],
  };
  const values=options?.length?options:(known[initial]||[initial]);
  const [internal,setInternal]=useState(initial);const value=controlled??internal;
  return <span className="select-wrap"><select className="select-box" value={value} onChange={event=>{setInternal(event.target.value);onChange?.(event.target.value)}} aria-label={initial}>{values.map(option=><option key={option}>{option}</option>)}</select><ChevronDown size={14}/></span>;
}

function VirtualKeyboard({ active, setActive, compact=false }: { active:Set<number>; setActive:(s:Set<number>)=>void; compact?:boolean }) {
  const notes=Array.from({length:88},(_,i)=>i+21); const whites=notes.filter(note=>!blackOffsets.has(note%12)); let whiteIndex=-1;
  const positions=new Map<number,number>(); notes.forEach(note=>{if(!blackOffsets.has(note%12))whiteIndex++;else positions.set(note,whiteIndex+.68)});
  const press=(note:number)=>{pianoEngine.noteOn(note,.72);setActive(new Set([...active,note]))};
  const release=(note:number)=>{pianoEngine.noteOff(note);const next=new Set(active);next.delete(note);setActive(next)};
  return <div className={`piano piano-88 ${compact?'compact':''}`} aria-label="Interactive 88-key virtual piano keyboard">
    <div className="white-keys">{whites.map(note=>{const octave=Math.floor(note/12)-1;const name=pianoNotes[note%12];return <button key={note} aria-label={`${name}${octave}`} className={`white-key ${active.has(note)?'active':''}`} onPointerDown={()=>press(note)} onPointerUp={()=>release(note)} onPointerLeave={()=>release(note)}>{name==='C'&&<small>C{octave}</small>}</button>})}</div>
    <div className="black-keys">{notes.filter(note=>blackOffsets.has(note%12)).map(note=><button key={note} aria-label={`${pianoNotes[note%12]}${Math.floor(note/12)-1}`} className={`black-key ${active.has(note)?'active':''}`} style={{left:`calc(${((positions.get(note)||0)/52)*100}% - .62%)`}} onPointerDown={()=>press(note)} onPointerUp={()=>release(note)} onPointerLeave={()=>release(note)}/>)}</div>
  </div>;
}

function Brand() {
  return <div className="brand"><span className="brand-bars">▮▮▮▮</span><strong>Piano<span>Tutor</span></strong></div>;
}

function Studio({ recording, setRecording, seconds }: { recording:boolean; setRecording:(v:boolean)=>void; seconds:number }) {
  const [scene, setScene] = useState(0);
  const [localScenes,setLocalScenes]=useState(scenes);
  const [active, setActive] = useState<Set<number>>(new Set([60,64,67,72]));
  const [cameraOn, setCameraOn] = useState(true);
  const [handsOn, setHandsOn] = useState(true);
  const [keysOn, setKeysOn] = useState(true);
  const [title, setTitle] = useState("Today's Lesson");
  const [accent, setAccent] = useState('#1d9cff');
  const [saved, setSaved] = useState(false);
  const [background,setBackground]=useState(0);
  const [layout,setLayout]=useState(0);
  const {catalog,refresh}=useDeviceCatalog();
  const [midiOutput,setMidiOutput]=useState('');
  const [cameraId,setStudioCameraId]=useState(''); const liveCamera=useRef<HTMLVideoElement>(null);
  const time = new Date(seconds*1000).toISOString().slice(11,19);
  useEffect(()=>{refresh(true).catch(()=>{})},[]);
  useEffect(()=>{let stream:MediaStream|undefined;const open=async()=>{if(!catalog.videoInputs.length)return;const id=cameraId||catalog.videoInputs[0].id;stream=await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:id},width:{ideal:1920},height:{ideal:1080}},audio:false});if(liveCamera.current){liveCamera.current.srcObject=stream;await liveCamera.current.play()}};open().catch(()=>{});return()=>stream?.getTracks().forEach(track=>track.stop())},[cameraId,catalog.videoInputs.map(x=>x.id).join('|')]);
  const applyScene=(index:number)=>{setScene(index);if(index===0){setCameraOn(true);setHandsOn(true);setKeysOn(true);setLayout(0)}else if(index===1){setCameraOn(false);setHandsOn(true);setKeysOn(true);setLayout(1)}else if(index===2){setCameraOn(true);setHandsOn(false);setKeysOn(true);setLayout(0)}else{setCameraOn(true);setHandsOn(true);setKeysOn(true);setLayout(2)}};
  const applyLayout=(index:number)=>{setLayout(index);if(index===0){setCameraOn(true);setHandsOn(true);setKeysOn(true)}else if(index===1){setCameraOn(false);setHandsOn(true);setKeysOn(true)}else{setCameraOn(true);setHandsOn(false);setKeysOn(true)}};

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const map = 'awsedftgyhujkolp;'; const i = map.indexOf(e.key.toLowerCase());
      if (i < 0 || e.repeat) return; pianoEngine.noteOn(60+i,.72); setActive(prev => new Set([...prev,60+i]));
    };
    const up = (e: KeyboardEvent) => { const i='awsedftgyhujkolp;'.indexOf(e.key.toLowerCase()); if(i>=0){pianoEngine.noteOff(60+i);setActive(prev=>{const n=new Set(prev);n.delete(60+i);return n;});} };
    window.addEventListener('keydown', handler); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', handler); window.removeEventListener('keyup', up); };
  }, []);
  useEffect(()=>pianoEngine.subscribe((note,on)=>setActive(previous=>{const next=new Set(previous);if(on)next.add(note);else next.delete(note);return next})),[]);

  return <main className="studio-grid">
    <aside className="side left-panel">
      <div className="panel-heading io-heading"><span>Inputs & outputs</span></div>
      <div className="quick-io">
        <label><Camera size={17}/><span>Camera<SelectBox value={catalog.videoInputs.find(x=>x.id===(cameraId||catalog.videoInputs[0]?.id))?.name||'No cameras found'} onChange={name=>setStudioCameraId(catalog.videoInputs.find(x=>x.name===name)?.id||'')} options={catalog.videoInputs.map(x=>x.name)}>No cameras found</SelectBox></span></label>
        <label><Mic2 size={17}/><span>Audio input<SelectBox options={catalog.audioInputs.map(x=>x.name)}>{catalog.audioInputs[0]?.name||'No audio inputs found'}</SelectBox></span></label>
        <label><Volume2 size={17}/><span>Audio output<SelectBox options={catalog.audioOutputs.map(x=>x.name)}>{catalog.audioOutputs[0]?.name||'Default audio output'}</SelectBox></span></label>
        <label><Keyboard size={17}/><span>MIDI input<SelectBox options={catalog.midiInputs.map(x=>x.name)}>{catalog.midiInputs[0]?.name||'Computer keyboard'}</SelectBox></span></label>
        <label><Piano size={17}/><span>MIDI output<SelectBox value={midiOutput||'Built-in Grand Piano'} onChange={name=>{setMidiOutput(name);const device=catalog.midiOutputs.find(x=>x.name===name);if(device)pianoEngine.selectMidiOutput(device.id)}} options={['Built-in Grand Piano',...catalog.midiOutputs.map(x=>x.name)]}>Built-in Grand Piano</SelectBox></span></label>
      </div>
      <hr/>
      <div className="panel-heading"><span>Scenes</span><button aria-label="Add scene" onClick={()=>{setLocalScenes(current=>[...current,{name:`Custom Scene ${current.length+1}`,subtitle:'Editable layout',color:'#176a9e'}]);setScene(localScenes.length)}}><Plus size={17}/></button></div>
      <div className="scene-list">{localScenes.map((s,i)=><div key={`${i}-${s.color}`} role="button" tabIndex={0} className={`scene ${scene===i?'selected':''}`} onClick={()=>applyScene(i)} onKeyDown={e=>e.key==='Enter'&&applyScene(i)}>
        <span className="scene-thumb" style={{background:`linear-gradient(140deg,${s.color},#06101b)`}}><MonitorPlay size={16}/></span>
        <span><input aria-label={`Scene ${i+1} name`} className="scene-name" value={s.name} onClick={()=>applyScene(i)} onChange={event=>setLocalScenes(current=>current.map((item,index)=>index===i?{...item,name:event.target.value}:item))}/><small>{s.subtitle}</small></span><button aria-label={`Delete ${s.name}`} className="dots" onClick={event=>{event.stopPropagation();if(localScenes.length>1){setLocalScenes(current=>current.filter((_,index)=>index!==i));setScene(0)}}}>×</button>
      </div>)}</div>
      <hr/>
      <div className="panel-heading"><span>Sources</span><button><Plus size={17}/></button></div>
      <div className="source-list">
        {[[Camera,'Face camera'],[Video,'Hands camera'],[Piano,'Virtual keyboard'],[BookOpen,'Lesson title']].map(([Icon,label],i)=>{
          const C = Icon as typeof Camera; return <button key={String(label)} className="source"><C size={16}/><span>{String(label)}</span>{i===0?<Lock size={13}/>:<Circle size={9} fill="#3b4d60"/>}</button>;
        })}
      </div>
      <hr/>
      <label className="section-label">Background</label>
      <div className="background-picks">{['studio','blue','wood','room','violet','mountain'].map((x,i)=><button onClick={()=>setBackground(i)} key={x} aria-label={`${x} background`} className={background===i?'selected':''}><span className={`bg-${x}`}/></button>)}</div>
      <label className="section-label keyboard-theme-label">Keyboard theme</label>
      <div className="color-picks compact-colors">{['#f4f7fb','#102235','#b4c3d5','#138cea','#7145d5','#37ad7c','#f04c55'].map((c,i)=><button aria-label={`Theme ${i+1}`} key={c} style={{background:c}} className={i===0?'selected':''}/>)}</div>
    </aside>

    <section className="studio-center">
      <div className="canvas-shell">
        <div className="canvas-topline"><span><Circle size={8} fill="#39dfa0" color="#39dfa0"/> LIVE PREVIEW</span><span>1920 × 1080 · 30 FPS</span></div>
        <div className="composition">
          <div className="lesson-card"><span className="mark">▮▮▮▮</span><small>LEARN · PLAY · GROW</small></div>
          {cameraOn && <div className="face-camera"><video ref={liveCamera} muted playsInline poster="./assets/references/02_tutorial_reference_multiview.jpeg" aria-label="Face camera preview"/></div>}
          <div className="lesson-copy"><span>{title}</span><strong>Chord<br/>Progressions</strong><p>I – IV – V in C Major</p></div>
          {keysOn && <div className="vmk"><VirtualKeyboard active={active} setActive={setActive} compact/></div>}
          {handsOn && <div className="hands-camera"><img src="./assets/references/01_tutorial_reference_keyboard_title.jpeg" alt="Overhead keyboard preview"/></div>}
        </div>
      </div>
      <div className="transport">
        <div className="transport-meta"><span className={recording?'recording-dot':''}><Circle size={9} fill="currentColor"/> {recording?'RECORDING':'READY'}</span><b>{time}</b></div>
        <div className="transport-controls"><button title="Return to start"><RotateCcw size={17}/></button><button className={`record ${recording?'active':''}`} onClick={()=>setRecording(!recording)} title={recording?'Stop recording':'Start recording'}>{recording?<Square size={18} fill="white"/>:<Circle size={25} fill="currentColor"/>}</button><button><Pause size={18}/></button></div>
        <div className="health"><span><i/> CPU 12%</span><span><i/> 30 FPS</span></div>
      </div>
    </section>

    <aside className="side right-panel">
      <div className="inspector-title"><span>Inspector</span><SlidersHorizontal size={16}/></div>
      <label className="section-label">Layout</label>
      <div className="layout-picks">{['Face + Keys','Top Logo','Split View'].map((x,i)=><button onClick={()=>applyLayout(i)} className={layout===i?'selected':''} key={x}><span className={`layout-icon l${i}`}/><small>{x}</small></button>)}</div>
      <hr/>
      <label className="section-label">Visible layers</label>
      <div className="settings-list">
        <span><Camera size={15}/>Face camera<Toggle value={cameraOn} onChange={setCameraOn} label="Face camera"/></span>
        <span><Video size={15}/>Hands camera<Toggle value={handsOn} onChange={setHandsOn} label="Hands camera"/></span>
        <span><Piano size={15}/>Virtual keyboard<Toggle value={keysOn} onChange={setKeysOn} label="Virtual keyboard"/></span>
      </div>
      <hr/>
      <label className="section-label">Lesson text</label>
      <input className="text-input" value={title} onChange={e=>setTitle(e.target.value)}/>
      <div className="field-row"><span>Typeface</span><SelectBox>Inter</SelectBox></div>
      <div className="field-row"><span>Size</span><SelectBox>36 px</SelectBox></div>
      <hr/>
      <label className="section-label">Keyboard highlight</label>
      <div className="color-picks">{['#fff','#1d9cff','#7746e9','#39b77b','#ffb12b','#ff4c55'].map(c=><button aria-label={`Use ${c}`} onClick={()=>setAccent(c)} key={c} className={accent===c?'selected':''} style={{background:c}}/>)}</div>
      <hr/>
      <label className="section-label">Recording</label>
      <div className="settings-list"><span><AudioLines size={15}/>Record audio<Toggle value={true} onChange={()=>{}} label="Record audio"/></span><span><Keyboard size={15}/>Record MIDI<Toggle value={true} onChange={()=>{}} label="Record MIDI"/></span></div>
      <button className="primary-action" onClick={()=>setRecording(!recording)}>{recording?<Square size={16} fill="white"/>:<Circle size={16} fill="#ff4c55" color="#ff4c55"/>}{recording?'Stop recording':'Start recording'}</button>
    </aside>
  </main>;
}

function Devices() {
  const [permission, setPermission] = useState<'idle'|'pending'|'ready'|'blocked'>('idle');
  const videoRef = useRef<HTMLVideoElement>(null); const secondVideoRef=useRef<HTMLVideoElement>(null); const streams=useRef<MediaStream[]>([]);
  const {catalog,refresh}=useDeviceCatalog(); const [cameraId,setCameraId]=useState(''); const [camera2Id,setCamera2Id]=useState(''); const [camera2On,setCamera2On]=useState(false);
  const [routes,setRoutes]=useState(['','','','']); const [monitor,setMonitor]=useState(72); const [monitorOutput,setMonitorOutput]=useState('');
  const connect = async () => {
    setPermission('pending');
    streams.current.forEach(stream=>stream.getTracks().forEach(track=>track.stop())); streams.current=[];
    try { await refresh(true);const stream=await navigator.mediaDevices.getUserMedia({video:cameraId?{deviceId:{exact:cameraId}}:true,audio:true});streams.current.push(stream); if(videoRef.current){videoRef.current.srcObject=stream;await videoRef.current.play();} setPermission('ready'); }
    catch { setPermission('blocked'); }
  };
  const connectSecond=async()=>{if(camera2On){const stream=streams.current.pop();stream?.getTracks().forEach(track=>track.stop());setCamera2On(false);return}try{const selected=camera2Id||catalog.videoInputs.find(x=>x.id!==(cameraId||catalog.videoInputs[0]?.id))?.id||catalog.videoInputs[0]?.id;if(!selected)return;const stream=await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:selected}},audio:false});streams.current.push(stream);if(secondVideoRef.current){secondVideoRef.current.srcObject=stream;await secondVideoRef.current.play()}setCamera2On(true)}catch{setPermission('blocked')}};
  useEffect(()=>()=>streams.current.forEach(stream=>stream.getTracks().forEach(track=>track.stop())),[]);
  const audioOptions=catalog.audioInputs.map(x=>x.name); const outputOptions=catalog.audioOutputs.map(x=>x.name);
  return <div className="workspace-page"><header><div><span className="eyebrow">HARDWARE SETUP</span><h1>Devices</h1><p>Connect cameras, audio inputs, MIDI, and monitoring.</p></div><button className="primary small" onClick={connect}><Zap size={15}/>{permission==='pending'?'Requesting…':permission==='ready'?'Refresh devices':'Connect devices'}</button></header>
    <div className="page-grid devices-grid"><section className="content-card camera-card"><div className="card-title"><div><Camera/><span><b>Camera 1</b><small>{permission==='ready'?'Live preview':'Face camera'}</small></span></div><span className={`status ${permission!=='ready'?'offline':''}`}>{permission==='ready'?'ACTIVE':'OFFLINE'}</span></div><div className="video-preview"><video ref={videoRef} muted playsInline/><span className="preview-placeholder"><Camera size={38}/><small>Connect to preview</small></span></div><div className="two-fields"><SelectBox value={cameraId||catalog.videoInputs[0]?.id||''} onChange={setCameraId} options={catalog.videoInputs.map(x=>x.id)}>{catalog.videoInputs[0]?.id||'No cameras found'}</SelectBox><SelectBox>1920 × 1080 · 30fps</SelectBox></div>{catalog.videoInputs.length>0&&<small className="device-name-hint">{catalog.videoInputs.find(x=>x.id===(cameraId||catalog.videoInputs[0]?.id))?.name}</small>}</section>
      <section className="content-card camera-card"><div className="card-title"><div><Camera/><span><b>Camera 2</b><small>Hands camera</small></span></div><Toggle value={camera2On} onChange={connectSecond} label="Camera 2"/></div><div className="video-preview"><video ref={secondVideoRef} muted playsInline/><span className="preview-placeholder"><Plus/><small>Select a second camera</small></span></div><SelectBox value={camera2Id||catalog.videoInputs[1]?.id||catalog.videoInputs[0]?.id||''} onChange={setCamera2Id} options={catalog.videoInputs.map(x=>x.id)}>{catalog.videoInputs[1]?.id||catalog.videoInputs[0]?.id||'No cameras found'}</SelectBox>{catalog.videoInputs.length>0&&<small className="device-name-hint">{catalog.videoInputs.find(x=>x.id===(camera2Id||catalog.videoInputs[1]?.id||catalog.videoInputs[0]?.id))?.name}</small>}</section>
      <section className="content-card span-two"><div className="card-title"><div><AudioLines/><span><b>Audio inputs</b><small>{catalog.audioInputs.length} Windows capture endpoint{catalog.audioInputs.length===1?'':'s'} available</small></span></div><button className="icon-btn" onClick={()=>refresh(true)} aria-label="Refresh audio devices"><RotateCcw size={16}/></button></div><div className="device-rows">{channels.slice(0,4).map((c,i)=><div key={c.name}><span className="device-num">{i+1}</span><span><b>{c.name}</b><small>{routes[i]||audioOptions[i]||'No device assigned'}</small></span><Meter level={routes[i]||audioOptions[i]?c.level:0}/><SelectBox value={routes[i]||audioOptions[i]||''} onChange={value=>setRoutes(current=>current.map((route,index)=>index===i?value:route))} options={audioOptions}>{audioOptions[i]||'No audio input'}</SelectBox></div>)}</div></section>
      <section className="content-card"><div className="card-title"><div><Keyboard/><span><b>MIDI input</b><small>Visualization + instrument</small></span></div><span className={`status ${catalog.midiInputs.length?'':'offline'}`}>{catalog.midiInputs.length?'CONNECTED':'NO DEVICE'}</span></div><SelectBox options={catalog.midiInputs.map(x=>x.name)}>{catalog.midiInputs[0]?.name||'Computer keyboard'}</SelectBox><div className="midi-strip"><Piano/><span><b>Acoustic Grand</b><small>{catalog.midiInputs[0]?.name||'Computer keyboard'} · Channel 1</small></span><button aria-label="Test MIDI instrument" onClick={()=>{pianoEngine.noteOn(60,.8);setTimeout(()=>pianoEngine.noteOff(60),600)}}><Play size={14}/></button></div></section>
      <section className="content-card"><div className="card-title"><div><Headphones/><span><b>Monitoring</b><small>Independent from recording</small></span></div><b className="monitor-value">{monitor}%</b></div><SelectBox value={monitorOutput||outputOptions[0]||''} onChange={setMonitorOutput} options={outputOptions}>{outputOptions[0]||'No audio output'}</SelectBox><div className="monitor-level"><Volume2/><input aria-label="Monitoring level" type="range" value={monitor} onChange={event=>setMonitor(+event.target.value)}/></div></section>
    </div>{permission==='blocked'&&<div className="toast error"><X/>Camera or microphone access was blocked. Update browser permissions and retry.</div>}</div>;
}

function Mixer() {
  const [ducking,setDucking]=useState(true); const [strength,setStrength]=useState(38); const [levels,setLevels]=useState(channels.map((_,i)=>65-i*6)); const [master,setMaster]=useState(76); const [muted,setMuted]=useState<Set<number>>(new Set()); const [solo,setSolo]=useState<Set<number>>(new Set()); const [limiter,setLimiter]=useState(true);
  const toggleSet=(setter:React.Dispatch<React.SetStateAction<Set<number>>>,index:number)=>setter(current=>{const next=new Set(current);next.has(index)?next.delete(index):next.add(index);return next});
  return <div className="workspace-page mixer-page"><header><div><span className="eyebrow">LIVE AUDIO</span><h1>Mixer</h1><p>Balance the lesson mix without leaving the teaching workflow.</p></div><div className="header-status"><i/> Audio engine ready · 48 kHz</div></header>
    <div className="mixer-layout"><section className="mixing-board">{channels.map((c,i)=>{const audible=!muted.has(i)&&(solo.size===0||solo.has(i));return <div className={`channel-strip ${audible?'':'silenced'}`} key={c.name}><div className="strip-head"><span className={`channel-icon c${i}`}><AudioLines/></span><b>{c.name}</b><small>{c.detail}</small></div><div className="tall-meter"><i style={{height:`${audible?Math.min(c.level,levels[i]):0}%`}}/></div><input className="vertical-range" aria-label={`${c.name} level`} type="range" value={levels[i]} onChange={event=>setLevels(current=>current.map((level,index)=>index===i?+event.target.value:level))}/><b className="db">{levels[i]===0?'−∞':`${((levels[i]-100)*.48).toFixed(1)} dB`}</b><div className="strip-buttons"><button aria-pressed={muted.has(i)} className={muted.has(i)?'active mute':''} onClick={()=>toggleSet(setMuted,i)}>M</button><button aria-pressed={solo.has(i)} className={solo.has(i)?'active solo':''} onClick={()=>toggleSet(setSolo,i)}>S</button></div></div>})}<div className="channel-strip master"><div className="strip-head"><span className="channel-icon"><Gauge/></span><b>Master</b><small>Stereo output</small></div><div className="tall-meter dual"><i style={{height:`${master}%`}}/></div><input className="vertical-range" aria-label="Master level" type="range" value={master} onChange={event=>setMaster(+event.target.value)}/><b className="db">{`${((master-100)*.32).toFixed(1)} dB`}</b><button className={`limiter ${limiter?'':'off'}`} aria-pressed={limiter} onClick={()=>setLimiter(!limiter)}>LIMITER {limiter?'ON':'OFF'}</button></div></section>
      <aside className="duck-card"><div className="card-title"><div><Sparkles/><span><b>Voice ducking</b><small>Natural space for speech</small></span></div><Toggle value={ducking} onChange={setDucking} label="Voice ducking"/></div><div className="gain-ring" style={{'--amount':`${strength*3.6}deg`} as React.CSSProperties}><span><b>−{Math.round(strength/7)}.0</b><small>dB reduction</small></span></div><label>Strength <b>{strength<34?'Light':strength<67?'Medium':'Strong'}</b></label><input type="range" value={strength} onChange={e=>setStrength(+e.target.value)}/><div className="field-row"><span>Trigger</span><SelectBox>Mic 1</SelectBox></div><div className="field-row"><span>Targets</span><SelectBox>Instrument bus</SelectBox></div><div className="duck-stats"><span><b>10 ms</b><small>Attack</small></span><span><b>120 ms</b><small>Hold</small></span><span><b>320 ms</b><small>Release</small></span></div><div className="tip"><WandSparkles/><p><b>Teaching preset</b><br/>Tuned for clear speech without audible pumping.</p></div></aside>
    </div></div>;
}

function LibraryPage() {
  type ProjectItem={filePath:string;name:string;savedAt:string;scene:string}; type RecordingItem={name:string;filePath:string;size:number;createdAt:string};
  const [tab,setTab]=useState<'Projects'|'Recordings'>('Projects'); const [projects,setProjects]=useState<ProjectItem[]>([]); const [recordings,setRecordings]=useState<RecordingItem[]>([]); const [status,setStatus]=useState('Loading library…');
  const refresh=async()=>{const api=window.pianoTutorDesktop;if(!api){setStatus('Desktop library is available in the installed app.');return}try{const [savedProjects,savedRecordings]=await Promise.all([api.listProjects(),api.listRecordings()]);setProjects(savedProjects);setRecordings(savedRecordings);setStatus('')}catch(error){setStatus(error instanceof Error?error.message:'Could not read the library')}};
  useEffect(()=>{refresh()},[]);
  const createProject=async()=>{const name=`Untitled Lesson ${new Date().toLocaleDateString(undefined,{month:'short',day:'numeric'})} ${new Date().toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}`;const filePath=await window.pianoTutorDesktop?.saveProject({name,scene:'Default Lesson',sources:[],createdAt:new Date().toISOString()});setStatus(filePath?'Project created':'Project could not be created');await refresh();setTab('Projects')};
  const open=(target:string)=>window.pianoTutorDesktop?.openPath(target);
  return <div className="workspace-page"><header><div><span className="eyebrow">YOUR WORK</span><h1>Library</h1><p>Projects and recordings saved on this PC.</p></div><button className="primary small" onClick={createProject}><Plus/>New project</button></header><div className="library-toolbar"><div className="tabs"><button className={tab==='Projects'?'active':''} onClick={()=>setTab('Projects')}>Projects <b>{projects.length}</b></button><button className={tab==='Recordings'?'active':''} onClick={()=>setTab('Recordings')}>Recordings <b>{recordings.length}</b></button></div><div className="library-actions"><button className="subtle-btn" onClick={refresh}><RotateCcw/>Refresh</button><button className="subtle-btn" onClick={()=>window.pianoTutorDesktop?.openLibraryFolder(tab==='Projects'?'projects':'recordings')}><FolderOpen/>Open folder</button></div></div>{status&&<div className="library-status">{status}</div>}{tab==='Projects'?<div className="project-grid">{projects.map((project,i)=><article className="project-tile" key={project.filePath}><div className={`project-cover cover-${i%3}`}><span className="mini-keys"/><button aria-label={`Open ${project.name}`} onClick={()=>open(project.filePath)}><FolderOpen/></button><small>PROJECT</small></div><div><b>{project.name}</b><p>{new Date(project.savedAt).toLocaleString()} · {project.scene}</p><span>Saved locally</span></div></article>)}</div>:<section className="recent-list recording-list"><div className="card-title"><div><Clock3/><span><b>Lesson recordings</b><small>Video captures in your PianoTutor folder</small></span></div></div>{recordings.map(recording=><div className="export-row" key={recording.filePath}><FileVideo/><span><b>{recording.name}</b><small>{(recording.size/1048576).toFixed(1)} MB · WebM recording</small></span><span>{new Date(recording.createdAt).toLocaleDateString()}</span><button aria-label={`Open ${recording.name}`} onClick={()=>open(recording.filePath)}><Play/></button></div>)}</section>}{!status&&((tab==='Projects'&&!projects.length)||(tab==='Recordings'&&!recordings.length))&&<div className="empty-library"><Library size={34}/><b>No {tab.toLowerCase()} yet</b><small>{tab==='Projects'?'Create your first lesson project.':'Record a lesson in Studio and it will appear here.'}</small></div>}</div>;
}

function SettingsPage() {
  type AppSettings={quality:string;encoder:string;autosave:boolean;retention:boolean;sampleRate:string;buffer:string;videoFormat:string;hardwareAcceleration:boolean;theme:string;compact:boolean;midiEnabled:boolean};
  const defaults:AppSettings={quality:'1080p · 30 fps',encoder:'H.264 · Auto',autosave:true,retention:true,sampleRate:'48 kHz',buffer:'256 samples',videoFormat:'16:9',hardwareAcceleration:true,theme:'Midnight Blue',compact:false,midiEnabled:true};
  const tabs=['Recording','Audio & MIDI','Video','Storage','Plug-ins','Shortcuts','Appearance'] as const; const [active,setActive]=useState<(typeof tabs)[number]>('Recording'); const [settings,setSettings]=useState(defaults); const [status,setStatus]=useState('');
  useEffect(()=>{window.pianoTutorDesktop?.loadSettings().then(value=>setSettings(current=>({...current,...value}))).catch(()=>setStatus('Could not load saved settings'))},[]);
  const update=<K extends keyof AppSettings>(key:K,value:AppSettings[K])=>setSettings(current=>({...current,[key]:value}));
  const saveNow=async()=>{const path=await window.pianoTutorDesktop?.saveSettings(settings);setStatus(path?'Settings saved':'Settings are only temporary in browser preview');setTimeout(()=>setStatus(''),2500)};
  const line=(title:string,detail:string,control:React.ReactNode)=><div className="setting-line"><span><b>{title}</b><small>{detail}</small></span>{control}</div>;
  let content:React.ReactNode;
  if(active==='Recording')content=<>{line('Video quality','Resolution and frame rate',<SelectBox value={settings.quality} onChange={value=>update('quality',value)}>1080p · 30 fps</SelectBox>)}{line('Encoder','Hardware acceleration when available',<SelectBox value={settings.encoder} onChange={value=>update('encoder',value)}>H.264 · Auto</SelectBox>)}{line('Source retention','Keep isolated camera, audio, and MIDI sources',<Toggle value={settings.retention} onChange={value=>update('retention',value)} label="Source retention"/>)}{line('Autosave & recovery','Protect project metadata during recording',<Toggle value={settings.autosave} onChange={value=>update('autosave',value)} label="Autosave"/>)}</>;
  else if(active==='Audio & MIDI')content=<>{line('Sample rate','Audio engine clock rate',<SelectBox value={settings.sampleRate} onChange={value=>update('sampleRate',value)} options={['44.1 kHz','48 kHz','96 kHz']}>48 kHz</SelectBox>)}{line('Buffer size','Lower values reduce monitoring latency',<SelectBox value={settings.buffer} onChange={value=>update('buffer',value)} options={['64 samples','128 samples','256 samples','512 samples','1024 samples']}>256 samples</SelectBox>)}{line('MIDI devices','Listen to connected Windows MIDI inputs',<Toggle value={settings.midiEnabled} onChange={value=>update('midiEnabled',value)} label="MIDI devices"/>)}<button className="subtle-btn" onClick={()=>pianoEngine.connectMidi().then(ok=>setStatus(ok?'MIDI scan complete':'No MIDI input found'))}><RotateCcw/>Rescan MIDI</button></>;
  else if(active==='Video')content=<>{line('Canvas format','Aspect ratio for lesson recordings',<SelectBox value={settings.videoFormat} onChange={value=>update('videoFormat',value)} options={['16:9','9:16','1:1']}>16:9</SelectBox>)}{line('Hardware acceleration','Use the GPU for previews and encoding',<Toggle value={settings.hardwareAcceleration} onChange={value=>update('hardwareAcceleration',value)} label="Hardware acceleration"/>)}</>;
  else if(active==='Storage')content=<>{line('Project folder','Documents\PianoTutor\Projects',<button className="subtle-btn" onClick={()=>window.pianoTutorDesktop?.openLibraryFolder('projects')}><FolderOpen/>Open</button>)}{line('Recording folder','Videos\PianoTutor',<button className="subtle-btn" onClick={()=>window.pianoTutorDesktop?.openLibraryFolder('recordings')}><FolderOpen/>Open</button>)}</>;
  else if(active==='Plug-ins')content=<><div className="diagnostic"><Zap/><span><b>Built-in instrument active</b><small>External VST3 hosting is reserved for the native audio engine.</small></span><span className="status">READY</span></div><button className="subtle-btn" onClick={()=>setStatus('Plug-in scan completed — built-in instrument available')}><RotateCcw/>Scan plug-ins</button></>;
  else if(active==='Shortcuts')content=<div className="shortcut-list">{[['Save project','Ctrl + S'],['Start / stop recording','Ctrl + R'],['Play piano','A–; keys'],['Return to Studio','Ctrl + 1']].map(([name,key])=><div className="setting-line" key={name}><span><b>{name}</b></span><kbd>{key}</kbd></div>)}</div>;
  else content=<>{line('Theme','Desktop interface color scheme',<SelectBox value={settings.theme} onChange={value=>update('theme',value)} options={['Midnight Blue','Graphite','High Contrast']}>Midnight Blue</SelectBox>)}{line('Compact controls','Reduce spacing in side panels',<Toggle value={settings.compact} onChange={value=>update('compact',value)} label="Compact controls"/>)}</>;
  return <div className="workspace-page"><header><div><span className="eyebrow">PREFERENCES</span><h1>Settings</h1><p>Recording quality, storage, performance, and shortcuts.</p></div><button className="primary small" onClick={saveNow}><Save/>Save settings</button></header><div className="settings-layout"><nav>{tabs.map((tab,i)=><button onClick={()=>setActive(tab)} className={active===tab?'active':''} key={tab}>{i===0?<Radio/>:<Settings/>}{tab}</button>)}</nav><section className="settings-sheet"><h2>{active}</h2><p>Configure {active.toLowerCase()} preferences for this Windows desktop.</p>{content}<hr/><h2>Performance</h2><div className="diagnostic"><Gauge/><span><b>Desktop engine ready</b><small>Electron capture · Web MIDI · Local project storage</small></span><span className="status">HEALTHY</span></div>{status&&<div className="inline-status">{status}</div>}</section></div></div>;
}

export default function App() {
  const [workspace,setWorkspace]=useState<Workspace>('Studio'); const [recording,setRecordingState]=useState(false); const [seconds,setSeconds]=useState(0); const [notice,setNotice]=useState('');
  const setRecording = async (next:boolean) => {
    try {
      if (next && !recording) { await desktopRecorder.start(); setSeconds(0); setRecordingState(true); setNotice('Recording started'); }
      else if (!next && recording) { const path=await desktopRecorder.stop('Piano_Tutorial');setRecordingState(false);setNotice(path?`Saved to ${path}`:'Recording stopped'); }
    } catch(error) { setRecordingState(false);setNotice(error instanceof Error?error.message:'Recording failed'); }
  };
  useEffect(()=>{if(!recording)return;const id=setInterval(()=>setSeconds(s=>s+1),1000);return()=>clearInterval(id)},[recording]);
  useEffect(()=>{pianoEngine.connectMidi().then(ok=>ok&&setNotice('MIDI keyboard connected')).catch(()=>{})},[]);
  useEffect(()=>{if(!notice)return;const id=setTimeout(()=>setNotice(''),4500);return()=>clearTimeout(id)},[notice]);
  useEffect(()=>{const save=async(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();const path=await window.pianoTutorDesktop?.saveProject({name:'Chord Progressions',workspace,scene:'Default Lesson'});setNotice(path?`Project saved to ${path}`:'Project saved')}};window.addEventListener('keydown',save);return()=>window.removeEventListener('keydown',save)},[workspace]);
  const page=useMemo(()=>workspace==='Studio'?<Studio recording={recording} setRecording={setRecording} seconds={seconds}/>:workspace==='Devices'?<Devices/>:workspace==='Mixer'?<Mixer/>:workspace==='Library'?<LibraryPage/>:<SettingsPage/>,[workspace,recording,seconds]);
  return <div className={`app ${window.pianoTutorDesktop?.isDesktop?'desktop-app':''}`}><header className="topbar"><Brand/><nav>{(['Studio','Devices','Mixer','Library','Settings'] as Workspace[]).map((w,i)=>{const Icon=[MonitorPlay,Wifi,SlidersHorizontal,Library,Settings][i];return <button key={w} className={workspace===w?'active':''} onClick={()=>setWorkspace(w)}><Icon size={17}/>{w==='Studio'?'Tutorial':w}</button>})}</nav><div className="top-actions"><span className={recording?'live':''}><Circle size={9} fill="currentColor"/>{recording?'REC':'READY'} {new Date(seconds*1000).toISOString().slice(11,19)}</span>{window.pianoTutorDesktop?.isDesktop?<div className="window-controls"><button aria-label="Minimize" onClick={()=>window.pianoTutorDesktop?.minimize()}><Minus/></button><button aria-label="Maximize" onClick={()=>window.pianoTutorDesktop?.maximize()}><Maximize2/></button><button aria-label="Close" onClick={()=>window.pianoTutorDesktop?.close()}><X/></button></div>:<button title="Export"><Upload size={17}/><span>Export</span></button>}</div></header>{page}{notice&&<div className="toast"><Circle size={9} fill="currentColor"/>{notice}</div>}</div>;
}
