class PianoEngine {
  private context?: AudioContext;
  private master?: GainNode;
  private voices = new Map<number, { oscillators: OscillatorNode[]; gain: GainNode }>();
  private midiAccess?: MIDIAccess;
  private midiOutput?: MIDIOutput;
  private listeners = new Set<(note:number,on:boolean,velocity:number)=>void>();

  private ensureAudio() {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.context.createGain();
      this.master.gain.value = 0.18;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') void this.context.resume();
  }

  noteOn(note: number, velocity = .7) {
    this.ensureAudio(); this.noteOff(note);
    const ctx=this.context!; const gain=ctx.createGain(); const frequency=440*Math.pow(2,(note-69)/12);
    gain.gain.setValueAtTime(.0001,ctx.currentTime); gain.gain.exponentialRampToValueAtTime(Math.max(.02,velocity*.26),ctx.currentTime+.012); gain.gain.exponentialRampToValueAtTime(Math.max(.01,velocity*.12),ctx.currentTime+.55);
    const oscillators=[1,2,3].map((ratio,index)=>{const osc=ctx.createOscillator();osc.type=index===0?'triangle':'sine';osc.frequency.value=frequency*ratio;const partial=ctx.createGain();partial.gain.value=[1,.18,.07][index];osc.connect(partial).connect(gain);osc.start();return osc;});
    gain.connect(this.master!); this.voices.set(note,{oscillators,gain});
    this.midiOutput?.send([0x90,note,Math.round(velocity*127)]);
    this.listeners.forEach(listener=>listener(note,true,velocity));
  }

  noteOff(note:number) { const voice=this.voices.get(note);if(voice&&this.context){const now=this.context.currentTime;voice.gain.gain.cancelScheduledValues(now);voice.gain.gain.setTargetAtTime(.0001,now,.18);voice.oscillators.forEach(osc=>osc.stop(now+.9));this.voices.delete(note);}this.midiOutput?.send([0x80,note,0]);this.listeners.forEach(listener=>listener(note,false,0)); }

  async connectMidi() {
    if (!('requestMIDIAccess' in navigator)) return false;
    const access = await navigator.requestMIDIAccess(); this.midiAccess=access;
    const bind=(input:MIDIInput)=>{input.onmidimessage=(event)=>{if(!event.data)return;const [status,note,velocity]=event.data;const command=status&0xf0;if(command===0x90&&velocity>0){this.ensureAudio();this.noteOn(note,velocity/127);}else if(command===0x80||(command===0x90&&velocity===0))this.noteOff(note);};};
    access.inputs.forEach(bind); access.onstatechange=()=>access.inputs.forEach(bind); return access.inputs.size>0;
  }

  async getMidiDevices() { if(!this.midiAccess)await this.connectMidi();return {inputs:Array.from(this.midiAccess?.inputs.values()||[]).map(x=>({id:x.id,name:x.name||'MIDI Input'})),outputs:Array.from(this.midiAccess?.outputs.values()||[]).map(x=>({id:x.id,name:x.name||'MIDI Output'}))}; }
  selectMidiOutput(id:string) { this.midiOutput=this.midiAccess?.outputs.get(id); }
  subscribe(listener:(note:number,on:boolean,velocity:number)=>void) { this.listeners.add(listener);return()=>{this.listeners.delete(listener)}; }
}

class DesktopRecorder {
  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private stream?: MediaStream;
  private audioContext?: AudioContext;
  private sourceStreams:MediaStream[]=[];

  async start() {
    if (!window.pianoTutorDesktop) throw new Error('Recording is available in the installed desktop app.');
    const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
    let microphone: MediaStream | undefined;
    try { microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false }, video: false }); } catch { /* video-only fallback */ }
    this.sourceStreams=[display,...(microphone?[microphone]:[])];const audioStreams=this.sourceStreams.filter(item=>Boolean(item.getAudioTracks().length));
    let audioTracks:MediaStreamTrack[]=[];
    if(audioStreams.length){this.audioContext=new AudioContext({latencyHint:'interactive'});const destination=this.audioContext.createMediaStreamDestination();audioStreams.forEach(item=>this.audioContext!.createMediaStreamSource(item).connect(destination));audioTracks=destination.stream.getAudioTracks()}
    this.stream=new MediaStream([...display.getVideoTracks(),...audioTracks]); this.chunks=[];
    const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
    this.recorder=new MediaRecorder(this.stream,mime?{mimeType:mime,videoBitsPerSecond:8_000_000}:undefined);
    this.recorder.ondataavailable=event=>{if(event.data.size)this.chunks.push(event.data)}; this.recorder.start(1000);
  }

  async stop(name:string) {
    if(!this.recorder)return '';
    const recorder=this.recorder; const stopped=new Promise<void>(resolve=>recorder.addEventListener('stop',()=>resolve(),{once:true}));
    recorder.stop(); await stopped; this.stream?.getTracks().forEach(track=>track.stop());this.sourceStreams.forEach(source=>source.getTracks().forEach(track=>track.stop()));this.sourceStreams=[];await this.audioContext?.close();this.audioContext=undefined;
    const buffer=await new Blob(this.chunks,{type:recorder.mimeType}).arrayBuffer(); this.recorder=undefined; this.stream=undefined;
    return window.pianoTutorDesktop?.saveRecording(buffer,name) || '';
  }
}

export const pianoEngine = new PianoEngine();
export const desktopRecorder = new DesktopRecorder();
