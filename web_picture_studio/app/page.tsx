"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Upload, Download, Undo2, RotateCcw, RotateCw, FlipHorizontal, FlipVertical, Crop, SlidersHorizontal, Paintbrush, Type, ZoomIn, ZoomOut, MousePointer2, Image as ImageIcon, Eraser, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";

type Tool = "adjust" | "background" | "crop" | "brush" | "text";
type BackgroundMode = "transparent" | "color";
type BackgroundResult = { provider:string; latencyMs:number; width:number; height:number };
type Settings = { brightness:number; contrast:number; saturation:number; blur:number; grayscale:number };
const DEFAULT: Settings = { brightness:100, contrast:100, saturation:100, blur:0, grayscale:0 };
const filterString = (s:Settings) => `brightness(${s.brightness}%) contrast(${s.contrast}%) saturate(${s.saturation}%) blur(${s.blur}px) grayscale(${s.grayscale}%)`;
const DESKTOP_MAX_DIM = 6000;
const MOBILE_MAX_DIM = 4096;
const MOBILE_MAX_PIXELS = 12_000_000;
const isCompactDevice = () => window.matchMedia("(max-width: 700px), (pointer: coarse)").matches;

const imageDimensions = (width:number,height:number) => {
  const compact=isCompactDevice();
  const maxDimension=compact?MOBILE_MAX_DIM:DESKTOP_MAX_DIM;
  const dimensionScale=maxDimension/Math.max(width,height);
  const pixelScale=compact?Math.sqrt(MOBILE_MAX_PIXELS/(width*height)):1;
  const scale=Math.min(1,dimensionScale,pixelScale);
  return {w:Math.max(1,Math.round(width*scale)),h:Math.max(1,Math.round(height*scale))};
};

const decodeImage = (source:string) => new Promise<HTMLImageElement>((resolve,reject) => {
  const image=new Image();
  image.onload=()=>resolve(image);
  image.onerror=()=>reject(new Error("Trình duyệt không đọc được định dạng ảnh này."));
  image.src=source;
});

export default function Home() {
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const historyRef = useRef<string[]>([]);
  const drawingRef = useRef(false);
  const startRef = useRef<{x:number;y:number} | null>(null);
  const autoRef = useRef(false);
  const [dimensions,setDimensions] = useState<{w:number;h:number}|null>(null);
  const [stageSize,setStageSize] = useState({w:900,h:650});
  const [url,setUrl] = useState("");
  const [filename,setFilename] = useState("Ảnh chưa mở");
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState("");
  const [tool,setTool] = useState<Tool>("adjust");
  const [settings,setSettings] = useState<Settings>(DEFAULT);
  const [zoom,setZoom] = useState(100);
  const [crop,setCrop] = useState<{x:number;y:number;w:number;h:number}|null>(null);
  const [brushSize,setBrushSize] = useState(12);
  const [brushColor,setBrushColor] = useState("#ff554e");
  const [label,setLabel] = useState("Văn bản của bạn");
  const [fontSize,setFontSize] = useState(48);
  const [format,setFormat] = useState<"png"|"jpeg">("png");
  const [revision,setRevision] = useState(0);
  const [drop,setDrop] = useState(false);
  const [historySize,setHistorySize] = useState(0);
  const [backgroundMode,setBackgroundMode] = useState<BackgroundMode>("transparent");
  const [backgroundColor,setBackgroundColor] = useState("#ffffff");
  const [backgroundBusy,setBackgroundBusy] = useState(false);
  const [backgroundResult,setBackgroundResult] = useState<BackgroundResult|null>(null);

  useEffect(() => {
    if (!stageRef.current) return;
    const observer = new ResizeObserver(entries => { const r=entries[0].contentRect; setStageSize({w:r.width,h:r.height}); });
    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const base=baseRef.current, display=canvasRef.current;
    if (!base || !display || !dimensions) return;
    display.width=base.width; display.height=base.height;
    const context=display.getContext("2d");
    if (!context) return;
    context.clearRect(0,0,display.width,display.height);
    context.filter=filterString(settings);
    context.drawImage(base,0,0);
    context.filter="none";
  },[settings,dimensions,revision]);

  const pushHistory = useCallback((source?:HTMLCanvasElement) => { const snapshot=source??baseRef.current; if (snapshot) { historyRef.current.push(snapshot.toDataURL("image/png")); const limit=isCompactDevice()?4:12; if(historyRef.current.length>limit) historyRef.current.splice(0,historyRef.current.length-limit); setHistorySize(historyRef.current.length); } },[]);
  const loadBitmap = useCallback(async (blob:Blob,name:string,resetWorkspace=true) => {
    if ((blob.type && !blob.type.startsWith("image/")) || blob.type === "image/svg+xml" || /\.svg$/i.test(name)) throw new Error("Hãy chọn ảnh PNG, JPEG, WebP, GIF, HEIC hoặc AVIF.");
    const objectURL=URL.createObjectURL(blob);
    try {
      const img=await decodeImage(objectURL);
      const {w,h}=imageDimensions(img.naturalWidth,img.naturalHeight);
      const base=document.createElement("canvas"); base.width=w; base.height=h;
      const context=base.getContext("2d");
      if(!context) throw new Error("Thiết bị không thể tạo vùng chỉnh sửa ảnh.");
      context.drawImage(img,0,0,w,h);
      baseRef.current=base;
      if(resetWorkspace) { historyRef.current=[]; setHistorySize(0); setBackgroundResult(null); setZoom(100); }
      setDimensions({w,h}); setFilename(name); setSettings(DEFAULT); setCrop(null); setTool(resetWorkspace?"adjust":"background"); setRevision(v=>v+1); setError("");
    } finally { URL.revokeObjectURL(objectURL); }
  },[]);

  const openUrl=useCallback(async (raw:string) => {
    setError(""); setLoading(true);
    try {
      const parsed=new URL(raw);
      if (!["http:","https:"].includes(parsed.protocol)) throw new Error("Vui lòng nhập link ảnh HTTP hoặc HTTPS.");
      const response=await fetch(`/api/image?url=${encodeURIComponent(parsed.toString())}`);
      if(!response.ok) { const data=await response.json().catch(()=>({})) as {error?:string}; throw new Error(data.error||"Không thể tải ảnh từ link này."); }
      const blob=await response.blob();
      await loadBitmap(blob,decodeURIComponent(parsed.pathname.split("/").pop()||"Ảnh từ link"));
    } catch(e) { setError(e instanceof Error?e.message:"Link ảnh không hợp lệ."); }
    finally { setLoading(false); }
  },[loadBitmap]);

  useEffect(() => {
    if(autoRef.current) return; autoRef.current=true;
    const params=new URLSearchParams(window.location.search);
    const image=params.get("image")||params.get("url");
    if(image) queueMicrotask(() => { setUrl(image); void openUrl(image); });
  },[openUrl]);

  const openFile=async (file?:File) => {
    if(!file) return;
    setLoading(true); setError("");
    try { if(file.size>30*1024*1024) throw new Error("Tệp ảnh vượt quá 30 MB."); await loadBitmap(file,file.name); }
    catch(e) { setError(e instanceof Error?e.message:"Không thể mở ảnh."); }
    finally { setLoading(false); if(fileRef.current) fileRef.current.value=""; }
  };
  const flatten=() => {
    const base=baseRef.current; if(!base) return;
    if(Object.values(settings).every((value,i)=>value===Object.values(DEFAULT)[i])) return;
    const temp=document.createElement("canvas"); temp.width=base.width; temp.height=base.height;
    const ctx=temp.getContext("2d")!; ctx.filter=filterString(settings); ctx.drawImage(base,0,0);
    base.getContext("2d")!.clearRect(0,0,base.width,base.height);
    base.getContext("2d")!.drawImage(temp,0,0); setSettings(DEFAULT);
  };
  const changeBase=(fn:(base:HTMLCanvasElement)=>HTMLCanvasElement|void) => {
    if(!baseRef.current) return;
    setBackgroundResult(null);
    pushHistory(); flatten();
    const result=fn(baseRef.current);
    if(result) baseRef.current=result;
    setDimensions({w:baseRef.current.width,h:baseRef.current.height}); setRevision(v=>v+1);
  };
  const undo=async () => {
    const snapshot=historyRef.current.pop(); if(!snapshot) return;
    setBackgroundResult(null);
    setHistorySize(historyRef.current.length);
    const img=await decodeImage(snapshot);
    const c=document.createElement("canvas"); c.width=img.width; c.height=img.height; c.getContext("2d")!.drawImage(img,0,0);
    baseRef.current=c; setSettings(DEFAULT); setDimensions({w:c.width,h:c.height}); setCrop(null); setRevision(v=>v+1);
  };
  const rotate=(dir:1|-1) => changeBase(base => {
    const c=document.createElement("canvas"); c.width=base.height; c.height=base.width;
    const ctx=c.getContext("2d")!; ctx.translate(dir===1?c.width:0,dir===1?0:c.height); ctx.rotate(dir*Math.PI/2); ctx.drawImage(base,0,0); return c;
  });
  const flip=(axis:"x"|"y") => changeBase(base => {
    const c=document.createElement("canvas"); c.width=base.width; c.height=base.height;
    const ctx=c.getContext("2d")!; ctx.translate(axis==="x"?base.width:0,axis==="y"?base.height:0); ctx.scale(axis==="x"?-1:1,axis==="y"?-1:1); ctx.drawImage(base,0,0); return c;
  });
  const applyCrop=() => {
    if(!crop || crop.w<5 || crop.h<5) return;
    changeBase(base => { const c=document.createElement("canvas"); c.width=Math.round(crop.w); c.height=Math.round(crop.h); c.getContext("2d")!.drawImage(base,crop.x,crop.y,crop.w,crop.h,0,0,c.width,c.height); return c; });
    setCrop(null); setTool("adjust");
  };
  const position=(event:React.PointerEvent<HTMLCanvasElement>) => {
    const r=event.currentTarget.getBoundingClientRect();
    return {x:Math.max(0,Math.min(dimensions!.w,(event.clientX-r.left)*dimensions!.w/r.width)),y:Math.max(0,Math.min(dimensions!.h,(event.clientY-r.top)*dimensions!.h/r.height))};
  };
  const pointerDown=(event:React.PointerEvent<HTMLCanvasElement>) => {
    if(!dimensions) return; const p=position(event);
    if(tool==="text") {
      if(!label.trim()) { setError("Nhập nội dung văn bản trước khi đặt lên ảnh."); return; }
      changeBase(base => { const ctx=base.getContext("2d")!; ctx.font=`700 ${fontSize}px Arial`; ctx.fillStyle=brushColor; ctx.textBaseline="top"; label.split("\n").forEach((line,i)=>ctx.fillText(line,p.x,p.y+i*fontSize*1.25)); });
      return;
    }
    if(tool==="crop") { startRef.current=p; setCrop({...p,w:0,h:0}); event.currentTarget.setPointerCapture(event.pointerId); return; }
    if(tool==="brush") { setBackgroundResult(null); pushHistory(); flatten(); drawingRef.current=true; startRef.current=p; event.currentTarget.setPointerCapture(event.pointerId); const ctx=baseRef.current!.getContext("2d")!; ctx.fillStyle=brushColor; ctx.beginPath(); ctx.arc(p.x,p.y,brushSize/2,0,Math.PI*2); ctx.fill(); setRevision(v=>v+1); }
  };
  const pointerMove=(event:React.PointerEvent<HTMLCanvasElement>) => {
    if(!dimensions || !startRef.current) return; const p=position(event);
    if(tool==="crop") { const s=startRef.current; setCrop({x:Math.min(s.x,p.x),y:Math.min(s.y,p.y),w:Math.abs(s.x-p.x),h:Math.abs(s.y-p.y)}); }
    if(tool==="brush" && drawingRef.current) { const ctx=baseRef.current!.getContext("2d")!; ctx.strokeStyle=brushColor; ctx.lineWidth=brushSize; ctx.lineCap="round"; ctx.lineJoin="round"; ctx.beginPath(); ctx.moveTo(startRef.current.x,startRef.current.y); ctx.lineTo(p.x,p.y); ctx.stroke(); startRef.current=p; setRevision(v=>v+1); }
  };
  const pointerUp=() => { drawingRef.current=false; startRef.current=null; };
  const download=() => {
    const canvas=canvasRef.current; if(!canvas || !dimensions) return;
    const out=document.createElement("canvas"); out.width=canvas.width; out.height=canvas.height;
    const ctx=out.getContext("2d")!;
    if(format==="jpeg") { ctx.fillStyle="#fff"; ctx.fillRect(0,0,out.width,out.height); }
    ctx.drawImage(canvas,0,0);
    out.toBlob(blob => { if(!blob) {setError("Không thể xuất ảnh này.");return;} const a=document.createElement("a"); const href=URL.createObjectURL(blob); a.href=href; a.download=`${filename.replace(/\.[^.]+$/,"")||"anh-da-sua"}-da-sua.${format==="jpeg"?"jpg":"png"}`; a.click(); setTimeout(()=>URL.revokeObjectURL(href),1000); },`image/${format}`,0.92);
  };
  const removeBackground=async () => {
    const canvas=canvasRef.current;
    if(!canvas || !dimensions) return;
    setBackgroundBusy(true); setBackgroundResult(null); setError("");
    try {
      const dataUrl=canvas.toDataURL("image/png");
      const imageBase64=dataUrl.slice(dataUrl.indexOf(",")+1);
      const padding=imageBase64.endsWith("==")?2:imageBase64.endsWith("=")?1:0;
      const imageBytes=Math.floor(imageBase64.length*3/4)-padding;
      if(!imageBase64 || imageBytes>30*1024*1024) throw new Error("Ảnh sau chỉnh sửa vượt quá giới hạn gửi 30 MB.");
      const form=new FormData();
      form.append("imageBase64",imageBase64);
      form.append("imageName",filename);
      form.append("backgroundMode",backgroundMode);
      form.append("backgroundColor",backgroundColor);
      form.append("outputFormat","png");
      form.append("maxDimension",String(Math.max(dimensions.w,dimensions.h)));
      form.append("sharpness","0");
      const response=await fetch("/api/portrait/background",{method:"POST",body:form});
      if(!response.ok) { const data=await response.json().catch(()=>({})) as {error?:string}; throw new Error(data.error||"Dịch vụ gRPC không xử lý được ảnh."); }
      const resultBlob=await response.blob();
      const resultName=response.headers.get("x-portrait-image-name")||`${filename.replace(/\.[^.]+$/,"").trim()||"portrait"}-no-bg.png`;
      pushHistory(canvas);
      await loadBitmap(resultBlob,resultName,false);
      setFormat("png");
      setBackgroundResult({provider:response.headers.get("x-portrait-provider")||"unknown",latencyMs:Number(response.headers.get("x-portrait-latency-ms"))||0,width:Number(response.headers.get("x-portrait-width"))||0,height:Number(response.headers.get("x-portrait-height"))||0});
    } catch(e) { setError(e instanceof Error?e.message:"Không thể gọi dịch vụ gRPC xử lý ảnh."); }
    finally { setBackgroundBusy(false); }
  };
  const fit=dimensions?Math.min((stageSize.w-60)/dimensions.w,(stageSize.h-60)/dimensions.h,1):1;
  const displayScale=Math.max(.02,fit*zoom/100);
  const renderedWidth=dimensions?Math.round(dimensions.w*displayScale):0;
  const renderedHeight=dimensions?Math.round(dimensions.h*displayScale):0;
  const setting=(key:keyof Settings,value:number) => setSettings(s=>({...s,[key]:value}));
  const selectTool=(next:Tool)=>{setTool(next);setCrop(null);};
  const dropFile=(event:React.DragEvent)=>{event.preventDefault();setDrop(false);void openFile(event.dataTransfer.files[0]);};

  useEffect(() => {
    const context=document.modelContext;
    if(!context?.registerTool) return;
    const lifecycle=new AbortController();
    void Promise.resolve(context.registerTool({name:"open_image_url",title:"Mở ảnh từ link",description:"Tải ảnh công khai từ URL HTTP(S) vào trình chỉnh sửa.",inputSchema:{type:"object",properties:{url:{type:"string"}},required:["url"],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},async execute(input:unknown){const v=input as {url?:unknown};if(typeof v?.url!=="string" || !/^https?:\/\//i.test(v.url)) throw new Error("URL không hợp lệ");setUrl(v.url);await openUrl(v.url);return {action:"image_load_requested",url:v.url};}}, {signal:lifecycle.signal})).catch(()=>{});
    return ()=>lifecycle.abort();
  },[openUrl]);

  return <main className="editor">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><ImageIcon size={19}/></span><span>studio<span style={{color:"#a2e7d2"}}>ảnh</span></span></div>
      <span className="top-sep"/><span className="filename" title={filename}>{filename}</span>
      <div className="top-actions">
        <Button variant="ghost" size="icon" onClick={()=>void undo()} disabled={!historySize} title="Hoàn tác" aria-label="Hoàn tác"><Undo2 size={18}/></Button>
        <Button variant="outline" onClick={()=>fileRef.current?.click()}><Upload size={17}/><span className="text-label">Mở ảnh</span></Button>
        <Button onClick={download} disabled={!dimensions} className="bg-[#a2e7d2] text-[#10221d] hover:bg-[#c4f5e5]"><Download size={17}/><span className="text-label">Xuất ảnh</span></Button>
      </div>
    </header>
    <div className="workspace">
      <nav className="tools" aria-label="Công cụ chỉnh sửa">
        {([{id:"adjust",name:"Điều chỉnh",icon:SlidersHorizontal},{id:"background",name:"Nền",icon:Eraser},{id:"crop",name:"Cắt ảnh",icon:Crop},{id:"brush",name:"Cọ vẽ",icon:Paintbrush},{id:"text",name:"Văn bản",icon:Type}] as const).map(item=><button key={item.id} className={`tool ${tool===item.id?"active":""}`} onClick={()=>selectTool(item.id)} title={item.name} aria-label={item.name} aria-pressed={tool===item.id}><item.icon size={20}/><span>{item.name}</span></button>)}
      </nav>
      <section ref={stageRef} className={`stage ${drop?"drop-active":""}`} aria-label="Vùng chỉnh sửa ảnh" onDragOver={e=>{e.preventDefault();setDrop(true)}} onDragLeave={()=>setDrop(false)} onDrop={dropFile}>
        {error && <div className="banner" role="alert">{error}</div>}
        {!dimensions ? <div className="empty">
          <div className="empty-illustration"><ImagePlus size={42} strokeWidth={1.5}/></div>
          <h1>Mở ảnh để bắt đầu chỉnh sửa</h1><p>Dán link ảnh công khai hoặc chọn ảnh từ thiết bị. Bạn có thể kéo thả ảnh vào đây.</p>
          <form className="url-form" onSubmit={e=>{e.preventDefault();void openUrl(url)}}><Input className="url-input" type="url" placeholder="https://example.com/hinh-anh.jpg" value={url} onChange={e=>setUrl(e.target.value)} aria-label="Link ảnh" required/><Button type="submit" className="bg-[#a2e7d2] text-[#10221d] hover:bg-[#c4f5e5]" disabled={loading}>{loading?"Đang mở...":"Mở link"}</Button></form>
          <div className="or">hoặc</div><Button variant="outline" onClick={()=>fileRef.current?.click()}><Upload size={16}/> Chọn ảnh từ thiết bị</Button>
        </div> : <div className="canvas-wrap" style={{width:renderedWidth,height:renderedHeight}}>
          <canvas ref={canvasRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} style={{cursor:tool==="crop"?"crosshair":tool==="brush"?"crosshair":tool==="text"?"text":"default"}} aria-label="Ảnh đang chỉnh sửa"/>
          {tool==="crop" && crop && <div className="crop-box" style={{left:`${crop.x/dimensions.w*100}%`,top:`${crop.y/dimensions.h*100}%`,width:`${crop.w/dimensions.w*100}%`,height:`${crop.h/dimensions.h*100}%`}}/>}
        </div>}
      </section>
      <aside className="properties" aria-label="Thuộc tính chỉnh sửa">
        <p className="panel-title">Không gian chỉnh sửa</p>
        <div className="section"><h2>Ảnh nguồn</h2>
          <form className="url-form" onSubmit={e=>{e.preventDefault();void openUrl(url)}}><Input className="url-input" type="url" placeholder="Dán link ảnh..." value={url} onChange={e=>setUrl(e.target.value)} aria-label="Link ảnh mới" required/><Button type="submit" variant="outline" size="icon" disabled={loading} title="Mở ảnh từ link" aria-label="Mở ảnh từ link"><ImagePlus size={17}/></Button></form>
          <p className="hint">{dimensions?`${dimensions.w} × ${dimensions.h} px`:"PNG, JPG, WebP, GIF, AVIF"}</p>
        </div>
        {tool==="adjust" && <>
          <div className="section"><h2>Ánh sáng & màu sắc</h2>
            {([{key:"brightness",name:"Độ sáng",min:0,max:200},{key:"contrast",name:"Tương phản",min:0,max:200},{key:"saturation",name:"Độ bão hòa",min:0,max:200},{key:"blur",name:"Làm mờ",min:0,max:20},{key:"grayscale",name:"Đen trắng",min:0,max:100}] as const).map(item=><div className="control" key={item.key}><div className="control-line"><label htmlFor={item.key}>{item.name}</label><output>{settings[item.key]}{item.key==="blur"?"px":"%"}</output></div><Slider id={item.key} min={item.min} max={item.max} step={1} value={[settings[item.key]]} onValueChange={values=>setting(item.key,values[0])} disabled={!dimensions} aria-label={item.name}/></div>)}
            <Button variant="outline" size="sm" onClick={()=>setSettings(DEFAULT)} disabled={!dimensions}>Đặt lại màu sắc</Button>
          </div>
          <div className="section"><h2>Xoay & lật</h2><div className="grid2"><Button variant="outline" onClick={()=>rotate(-1)} disabled={!dimensions}><RotateCcw size={16}/> Trái 90°</Button><Button variant="outline" onClick={()=>rotate(1)} disabled={!dimensions}><RotateCw size={16}/> Phải 90°</Button><Button variant="outline" onClick={()=>flip("x")} disabled={!dimensions}><FlipHorizontal size={16}/> Lật ngang</Button><Button variant="outline" onClick={()=>flip("y")} disabled={!dimensions}><FlipVertical size={16}/> Lật dọc</Button></div></div>
        </>}
        {tool==="background" && <div className="section background-panel"><div className="section-heading"><div><h2>Khử & đổi nền</h2><p className="hint">Ảnh hiện tại sẽ được gửi tới dịch vụ xử lý riêng.</p></div><span className="privacy-badge">gRPC</span></div>
          <div className="background-mode" role="group" aria-label="Kiểu nền"><button type="button" className={backgroundMode==="transparent"?"active":""} onClick={()=>setBackgroundMode("transparent")} disabled={backgroundBusy}><span className="transparent-chip"/>Trong suốt</button><button type="button" className={backgroundMode==="color"?"active":""} onClick={()=>setBackgroundMode("color")} disabled={backgroundBusy}><Palette size={16}/>Màu nền</button></div>
          {backgroundMode==="color" && <div className="background-color"><div className="inline color-picker-row"><label htmlFor="background-color">Màu tùy chọn</label><input id="background-color" className="color-input" type="color" value={backgroundColor} onChange={event=>setBackgroundColor(event.target.value)} disabled={backgroundBusy}/><Input key={backgroundColor} defaultValue={backgroundColor.toUpperCase()} onBlur={event=>{if(/^#[0-9a-f]{6}$/i.test(event.target.value)) setBackgroundColor(event.target.value); else event.target.value=backgroundColor.toUpperCase();}} onKeyDown={event=>{if(event.key==="Enter") event.currentTarget.blur();}} aria-label="Mã màu nền" className="hex-input" maxLength={7} disabled={backgroundBusy}/></div><div className="swatches" aria-label="Màu nền gợi ý">{["#FFFFFF","#F4F1EA","#A2E7D2","#BBD7FF","#FFD3C8","#191F29"].map(color=><button key={color} type="button" className={backgroundColor.toUpperCase()===color?"swatch active":"swatch"} style={{background:color}} onClick={()=>setBackgroundColor(color)} aria-label={`Chọn màu ${color}`} title={color} disabled={backgroundBusy}/>)}</div></div>}
          <Button onClick={()=>void removeBackground()} disabled={!dimensions || backgroundBusy} className="w-full bg-[#a2e7d2] text-[#10221d] hover:bg-[#c4f5e5]"><Eraser size={16}/>{backgroundBusy?"Đang xử lý qua gRPC...":"Khử nền tự động"}</Button>
          {backgroundResult && <div className="segmentation-summary" role="status"><span className="grpc-success" aria-hidden="true">✓</span><span>Đã xử lý bằng <strong>{backgroundResult.provider}</strong>{backgroundResult.latencyMs>0?` trong ${Math.round(backgroundResult.latencyMs)} ms`:""}{backgroundResult.width>0&&backgroundResult.height>0?` · ${backgroundResult.width} × ${backgroundResult.height} px`:""}</span></div>}
        </div>}
        {tool==="crop" && <div className="section"><h2>Cắt ảnh</h2><p className="hint">Kéo chuột hoặc chạm để chọn vùng ảnh muốn giữ.</p><Button onClick={applyCrop} disabled={!crop || crop.w<5 || crop.h<5} className="bg-[#a2e7d2] text-[#10221d] hover:bg-[#c4f5e5]"><Crop size={16}/> Áp dụng cắt</Button></div>}
        {tool==="brush" && <div className="section"><h2>Cọ vẽ</h2><div className="control"><div className="control-line"><label htmlFor="brush-size">Kích thước</label><output>{brushSize}px</output></div><Slider id="brush-size" min={2} max={80} value={[brushSize]} onValueChange={v=>setBrushSize(v[0])}/></div><div className="inline"><label htmlFor="brush-color">Màu cọ</label><input id="brush-color" className="color-input" type="color" value={brushColor} onChange={e=>setBrushColor(e.target.value)}/></div><p className="hint">Vẽ trực tiếp lên ảnh bằng chuột hoặc cảm ứng.</p></div>}
        {tool==="text" && <div className="section"><h2>Thêm văn bản</h2><label htmlFor="text-content" className="control-line">Nội dung</label><Input id="text-content" value={label} onChange={e=>setLabel(e.target.value)} className="url-input"/><div className="control" style={{marginTop:18}}><div className="control-line"><label htmlFor="font-size">Cỡ chữ</label><output>{fontSize}px</output></div><Slider id="font-size" min={12} max={200} value={[fontSize]} onValueChange={v=>setFontSize(v[0])}/></div><div className="inline"><label htmlFor="text-color">Màu chữ</label><input id="text-color" className="color-input" type="color" value={brushColor} onChange={e=>setBrushColor(e.target.value)}/></div><p className="hint">Nhấp vào ảnh để đặt văn bản.</p></div>}
        <div className="section"><h2>Thu phóng</h2><div className="inline"><Button variant="outline" size="icon" onClick={()=>setZoom(Math.max(25,zoom-25))} disabled={!dimensions} aria-label="Thu nhỏ"><ZoomOut size={16}/></Button><span style={{minWidth:52,textAlign:"center",fontSize:14}}>{zoom}%</span><Button variant="outline" size="icon" onClick={()=>setZoom(Math.min(300,zoom+25))} disabled={!dimensions} aria-label="Phóng to"><ZoomIn size={16}/></Button><Button variant="ghost" size="sm" onClick={()=>setZoom(100)} disabled={!dimensions}>Vừa khung</Button></div></div>
        <div className="section"><h2>Xuất ảnh</h2><div className="grid2"><Button variant={format==="png"?"default":"outline"} onClick={()=>setFormat("png")}>PNG</Button><Button variant={format==="jpeg"?"default":"outline"} onClick={()=>setFormat("jpeg")}>JPEG</Button></div><p className="hint">Ảnh được lưu về thiết bị của bạn.</p><Button onClick={download} disabled={!dimensions} className="w-full bg-[#a2e7d2] text-[#10221d] hover:bg-[#c4f5e5]"><Download size={16}/> Tải ảnh xuống</Button></div>
      </aside>
    </div>
    <footer className="statusbar"><span>{dimensions?`${dimensions.w} × ${dimensions.h} px · ${filename}`:"Chưa có ảnh trong vùng làm việc"}</span><span><MousePointer2 size={12} style={{display:"inline",verticalAlign:"middle"}}/> {backgroundBusy?"Đang chờ dịch vụ gRPC":tool==="background"?"Sẵn sàng khử nền":tool==="crop"?"Kéo để chọn vùng":tool==="brush"?"Kéo để vẽ":tool==="text"?"Nhấp để đặt chữ":"Sẵn sàng chỉnh sửa"}</span></footer>
    <input ref={fileRef} type="file" accept="image/*" hidden onChange={e=>void openFile(e.target.files?.[0])}/>
  </main>;
}
