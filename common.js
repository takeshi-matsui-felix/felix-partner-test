// ============================================================
// Felix検査App 新画面 共通部品（物件登録・検査実施・検査内容確認で共有）
// ============================================================
const SB_URL = "https://vzuzeymvyftmfuaxrvtb.supabase.co";
const SB_KEY = "sb_publishable_2y-rvfayu8BYs0oo-UOzGA_EQTBYLxm";
const H = {apikey: SB_KEY, Authorization: "Bearer " + SB_KEY};
const DELETE_PASSWORD = "5963";   // 物件の削除用（旧アプリと同じ。ログイン用PASSは最後に別途組み込む）

const SHANAI = ["社内検査(設計)", "社内検査(建設)", "社内検査(マーケ)", "社内検査(不動産)"];
const SPECIAL = ["配筋検査", "躯体検査", "断熱検査", "中間検査"];   // 階層・部位を選ばない検査
const INSP_OPTS = ["配筋検査","躯体検査","断熱検査","中間検査","社内検査(設計)","社内検査(建設)","社内検査(マーケ)","社内検査(不動産)",
  "【検査機関】配筋検査","【検査機関】躯体検査","【検査機関】断熱検査","【検査機関】中間検査","【検査機関】完了検査"];
const INSPECTOR_OPTS = ["工事監理チーム","建設部","不動産事業部","マーケティング部","検査機関"];
const FLOOR_OPTS = ["101","102","103","201","202","203","301","302","303","共用部","外部"];
const AREA_STANDARD = ["玄関","廊下・階段・ENT","LDK","キッチン","洋室","洗面室","UB","トイレ","バルコニー","外部","フリー項目"];
const AREA_SHANAI = ["玄関","トイレ","キッチン","LDK","バルコニー","洋室","洗面室","UB","廊下・階段・ENT","外部","フリー項目"];
const AREA_ORDER = ["玄関","トイレ","キッチン","バルコニー","LDK","洋室","洗面室","UB","廊下・階段・ENT","外部","フリー項目"];
const WORK_ORDER = ["A.リペア","B.清掃","C.クロス","D.造作","E.水道","F.電気","G.キッチン","H.サッシ","I.外壁","J.外構","K.コーキング","L.ガス","板金","Z.その他"];
const WORK_SHANAI = [...WORK_ORDER];
const WORK_STANDARD = ["基礎工事(鉄筋)","基礎工事(型枠)","フレーミング","FM","造作","内装","電気","設備","ガス","清掃","サッシ","外壁","外構","コーキング","リペア","その他"];
const WORK_MAP = {
  "配筋検査":["基礎工事(鉄筋)","水道","ガス","その他"],
  "躯体検査":["フレーミング","電気","水道","防水","その他"],
  "断熱検査":["断熱","造作","電気","設備","その他"],
  "中間検査":["造作","電気","水道","外壁","ガス","足場","その他"]
};
const WORK_KIKAN = ["基礎工事","フレーミング","防水","造作","内装","電気","設備","ガス","サッシ","外壁","足場","外構","その他"];
function workOpts(tn){
  if(tn.startsWith("【検査機関】")) return WORK_KIKAN;
  if(SHANAI.includes(tn)) return WORK_SHANAI;
  return WORK_MAP[tn] || WORK_STANDARD;
}
function areaOpts(tn){ return SHANAI.includes(tn) ? AREA_SHANAI : AREA_STANDARD; }
// 定型文の工種が全角カッコ（基礎工事（鉄筋））でも、選択肢の半角カッコに合わせる
function normW(w){ return String(w||"").replace(/（/g,"(").replace(/）/g,")"); }
// その検査種類で使う「分類」辞書（旧アプリと同じ規則）
function catDict(tn, area){
  if(SPECIAL.includes(tn)) return ISSUE_TEMPLATES[tn] || {};
  if(SHANAI.includes(tn)) return (ISSUE_TEMPLATES["社内検査(設計)"] || {})[area] || {};
  return {};
}

// ---- 基本ヘルパー ----
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
function lsDel(k){ try{ localStorage.removeItem(k); }catch(e){} }
function uuid(){ return crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{const r=Math.random()*16|0;return (c==="x"?r:(r&3|8)).toString(16);}); }
function todayISO(){ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function todayStr(){ return todayISO().replace(/-/g,"/"); }
function toast(m, ok=true){ const t=$("#toast"); t.textContent=(ok?"✅ ":"⚠️ ")+m; t.className=ok?"ok":"ng"; t.style.display="block"; clearTimeout(toast.h); toast.h=setTimeout(()=>t.style.display="none",ok?3000:5000); }
const IS_MOBILE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);

// ---- 通信 ----
async function sget(table, params){
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${params}`, {headers: H});
  if(!r.ok) throw new Error(`${table} 取得失敗 (${r.status})`);
  return r.json();
}
// 1000件を超えても全件取得（ページを分けて取る）
async function sgetAll(table, params){
  const out=[], size=1000;
  for(let from=0;;from+=size){
    const r=await fetch(`${SB_URL}/rest/v1/${table}?${params}`,{headers:{...H,Range:`${from}-${from+size-1}`,"Range-Unit":"items"}});
    if(!r.ok&&r.status!==206) throw new Error(`${table} 取得失敗 (${r.status})`);
    const rows=await r.json(); out.push(...rows); if(rows.length<size) break;
  }
  return out;
}
// 管理用Edge Function（秘密のキーが必要な操作）を呼ぶ
const FN_URL = SB_URL + "/functions/v1/felix-admin";
async function callAdmin(pin, action, payload){
  let r;
  try{ r=await fetch(FN_URL,{method:"POST",headers:{...H,"Content-Type":"application/json"},body:JSON.stringify({pin,action,...(payload||{})})}); }
  catch(e){ throw new Error("通信に失敗しました。電波の良い場所でお試しください"); }
  let j={}; try{ j=await r.json(); }catch(e){}
  if(!r.ok) throw new Error(j.error||`管理用機能がエラーを返しました (${r.status})。Edge Functionの設定を確認してください`);
  return j;
}
async function spost(table, body){
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {method:"POST", headers:{...H,"Content-Type":"application/json","Prefer":"return=minimal"}, body: JSON.stringify(body)});
  if(r.status===409) return "duplicate";   // 同じIDが既にある＝すでに送信済み
  if(!r.ok) throw new Error(`${table} 登録失敗 (${r.status})`);
  return "ok";
}
async function spatch(table, col, val, body){
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${col}=eq.${encodeURIComponent(val)}`, {
    method:"PATCH", headers:{...H,"Content-Type":"application/json","Prefer":"return=minimal"}, body: JSON.stringify(body)});
  if(!r.ok) throw new Error(`更新失敗 (${r.status})`);
}
async function upload(blob, name){
  // ※upsert（上書き）は使わない：この保存先は「新規追加」のみ許可されているため
  const r = await fetch(`${SB_URL}/storage/v1/object/photos/${name}`, {
    method:"POST", headers:{...H,"Content-Type":"image/jpeg","Cache-Control":"public, max-age=31536000, immutable"}, body: blob});
  if(!r.ok){
    let body=""; try{ body=await r.text(); }catch(e){}
    // 同じ名前の写真がすでにある＝前回の送信で届いている。成功として扱う（再送しても二重にならない）
    if(/Duplicate|already exists|"statusCode":"?409/i.test(body)) return `${SB_URL}/storage/v1/object/public/photos/${name}`;
    throw new Error(`写真アップロード失敗 (${r.status}) ${body.slice(0,120)}`);
  }
  return `${SB_URL}/storage/v1/object/public/photos/${name}`;
}

// ---- 並び順 ----
function sortProps(props){
  return [...props].sort((a,b)=>{
    const ka=(a.handover_date||"").trim()?[0,a.handover_date]:[1,"9999-12-31"];
    const kb=(b.handover_date||"").trim()?[0,b.handover_date]:[1,"9999-12-31"];
    return ka[0]-kb[0]||(ka[1]<kb[1]?-1:ka[1]>kb[1]?1:0);
  });
}
function sortRecs(rs){
  const k=r=>[AREA_ORDER.indexOf(r.area)<0?999:AREA_ORDER.indexOf(r.area), WORK_ORDER.indexOf(r.work_type)<0?999:WORK_ORDER.indexOf(r.work_type)];
  return [...rs].sort((a,b)=>{const x=k(a),y=k(b);return x[0]-y[0]||x[1]-y[1];});
}

// ---- 画像：縮小(長辺800・画質0.6)＋右下に電子黒板。サムネは合成後から作る ----
async function toBitmap(file){
  if(window.createImageBitmap){ try{ return await createImageBitmap(file,{imageOrientation:"from-image"}); }catch(e){} }
  return new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=URL.createObjectURL(file); });
}
function drawJpeg(src, maxSide, q){
  const k=Math.min(1,maxSide/Math.max(src.width,src.height));
  const c=document.createElement("canvas"); c.width=Math.round(src.width*k); c.height=Math.round(src.height*k);
  c.getContext("2d").drawImage(src,0,0,c.width,c.height);
  return new Promise(res=>c.toBlob(res,"image/jpeg",q));
}
function wrapText(ctx,text,x,y,maxW,lh,maxLines){
  if(!text) return y;
  let line="",n=0; const chars=text.split("");
  for(let i=0;i<chars.length;i++){
    const t=line+chars[i];
    if(ctx.measureText(t).width>maxW && i>0){ ctx.fillText(line,x,y); line=chars[i]; y+=lh; n++; if(n>=maxLines) return y; }
    else line=t;
  }
  ctx.fillText(line,x,y); return y+lh;
}
async function makePhotoSet(file, board, mode){
  const bmp=await toBitmap(file);
  const k=Math.min(1,800/Math.max(bmp.width,bmp.height));
  const w=Math.round(bmp.width*k), h=Math.round(bmp.height*k);
  const c=document.createElement("canvas"); c.width=w; c.height=h;
  const ctx=c.getContext("2d"); ctx.drawImage(bmp,0,0,w,h);
  const bw=w*0.40, bh=h*0.32, sx=w-bw-10, sy=h-bh-10;
  ctx.fillStyle=(mode==="insp")?"rgba(0, 50, 0, 0.85)":"rgba(0, 40, 80, 0.9)"; ctx.fillRect(sx,sy,bw,bh);
  ctx.strokeStyle="white"; ctx.lineWidth=2; ctx.strokeRect(sx+5,sy+5,bw-10,bh-10);
  ctx.fillStyle="white";
  const fs=Math.floor(w*0.022);
  ctx.font=fs+"px 'Yu Gothic Medium','Hiragino Kaku Gothic ProN',sans-serif";
  const ls=fs*1.4, tx=sx+10, dw=bw-20; let ty=sy+fs+12;
  ty=wrapText(ctx,board.propName,tx,ty,dw,ls,2);
  ty=wrapText(ctx,board.inspType+"  "+board.inspDate,tx,ty,dw,ls,2);
  ty=wrapText(ctx,board.locationText,tx,ty,dw,ls,2);
  ctx.fillStyle="#ffdddd"; wrapText(ctx,board.issueDetail,tx,ty,dw,ls,3);
  const full=await new Promise(res=>c.toBlob(res,"image/jpeg",0.6));
  const thumb=await drawJpeg(c,400,0.5);
  return {full, thumb};
}
function cut80(s){ s=s||""; return s.length>80 ? s.slice(0,80)+"..." : s; }

// ---- 画面部品 ----
// 選択肢（スマホで押しやすい丸ボタン）
function chips(name, opts, sel){
  return `<div class="chips">${opts.map(o=>`<label><input type="radio" name="${esc(name)}" value="${esc(o)}" ${o===sel?"checked":""}><span>${esc(o)}</span></label>`).join("")}</div>`;
}
function chipVal(root, name){ const e=(root||document).querySelector(`input[name="${CSS.escape(name)}"]:checked`); return e?e.value:""; }
// 写真ボタン（ライブラリ／カメラ）
function camButtons(attr, id, shotLabel){
  return `<div class="btns"><label class="cam lib">📁 ライブラリ<input type="file" accept="image/*" ${attr}="${esc(id)}"></label>
    ${IS_MOBILE?`<label class="cam shot">📷 ${shotLabel||"カメラ起動"}<input type="file" accept="image/*" capture="environment" ${attr}="${esc(id)}"></label>`:""}</div>`;
}
function spinBtn(btn, text){ btn.disabled=true; btn.dataset.t=btn.innerHTML; btn.innerHTML=`<span class="sp"></span>${text||"処理中…"}`; }
function unspinBtn(btn){ btn.disabled=false; if(btn.dataset.t) btn.innerHTML=btn.dataset.t; }
function showError(root, msg, retry){
  root.innerHTML=`<div class="err">${esc(msg)}</div><button class="btn btn-primary" id="retry">もう一度読み込む</button>`;
  $("#retry").onclick=retry;
}

// ---- ログイン中の役割（home.html で選択。端末内に保存）----
const OLD_APP_URL = "";   // 旧アプリ（Streamlit）のURL。安全検証ツールへの案内に使う。空なら表示しない
function getRole(){ try{ return JSON.parse(lsGet("felix_role")||"null"); }catch(e){ return null; } }
function setRole(r){ lsSet("felix_role", JSON.stringify(r)); }
function clearRole(){ lsDel("felix_role"); }

// ---- ページ共通の土台（通知・拡大表示・ナビ）----
// need: "admin"（管理者のみ）/ "any"（誰でも。ログイン済みであること）
function initPage(activeKey, need){
  const role=getRole();
  if(need && (!role || (need==="admin" && role.role!=="admin"))){ location.replace("home.html"); }
  document.body.insertAdjacentHTML("beforeend",`<div id="lb"><img alt=""></div><div id="toast"></div>`);
  $("#lb").onclick=()=>{$("#lb").style.display="none";};
  document.addEventListener("click",e=>{ const im=e.target.closest&&e.target.closest("[data-full]"); if(im){ $("#lb img").src=im.dataset.full; $("#lb").style.display="flex"; }});
  const admin=[["home","ホーム","home.html?m=1"],["properties","物件登録","properties.html"],["inspect","検査実施","inspect.html"],["verify","検査内容確認","verify.html"],["admin","是正ダッシュボード","admin.html"],["done","完了分一覧","done.html"],["safety","安全検証ツール","safety.html"]];
  const partner=[["home","ホーム","home.html?m=1"],["partner","是正実施","index.html"]];
  const pages=(role&&role.role==="partner")?partner:admin;
  document.querySelector("header").insertAdjacentHTML("afterend",`<nav id="nav">${pages.map(p=>`<a href="${p[2]}" class="${p[0]===activeKey?"on":""}">${p[1]}</a>`).join("")}</nav>`);
}

// ---- 送信前の写真を端末内に保管（ブラウザを閉じても消えない：IndexedDB）----
const IDB = {
  db: null,
  open(){
    if(this.db) return Promise.resolve(this.db);
    return new Promise((res,rej)=>{
      const rq=indexedDB.open("felix_new",1);
      rq.onupgradeneeded=()=>{ const d=rq.result; d.createObjectStore("pending",{keyPath:"temp_id"}); d.createObjectStore("meta",{keyPath:"k"}); };
      rq.onsuccess=()=>{ this.db=rq.result; res(this.db); };
      rq.onerror=()=>rej(rq.error);
    });
  },
  async tx(store, mode, fn){
    const db=await this.open();
    return new Promise((res,rej)=>{ const t=db.transaction(store,mode); const out=fn(t.objectStore(store)); t.oncomplete=()=>res(out&&out.result!==undefined?out.result:undefined); t.onerror=()=>rej(t.error); t.onabort=()=>rej(t.error); });
  },
  put(store,v){ return this.tx(store,"readwrite",s=>s.put(v)); },
  del(store,k){ return this.tx(store,"readwrite",s=>s.delete(k)); },
  get(store,k){ return this.tx(store,"readonly",s=>s.get(k)); },
  all(store){ return this.tx(store,"readonly",s=>s.getAll()); },
  async clearPending(inspId){ const all=await this.all("pending"); for(const r of all) if(r.inspection_id===inspId) await this.del("pending",r.temp_id); }
};

// ---- 指摘の修正フォーム（検査内容確認・検査実施の「確認・修正」で共用）----
function editorHtml(r, tn){
  const floor=r.floor_level||"", area=r.area||"", detail=r.issue_detail||"", w=r.work_type||"";
  const id=r.record_id, kikan=tn.startsWith("【検査機関】"), special=SPECIAL.includes(tn);
  const wo=[...new Set([...(w&&!workOpts(tn).includes(w)?[w]:[]),...workOpts(tn)])];
  return `<details class="sub"><summary>指摘内容・写真を修正する</summary>
    ${(kikan||special)?"":`<div class="lab">階層</div>${chips("ef_"+id,FLOOR_OPTS,floor)}<div class="lab">部位</div>${chips("ea_"+id,areaOpts(tn),area)}`}
    <div class="lab">指摘内容</div><textarea rows="3" data-ed="${esc(id)}">${esc(detail)}</textarea>
    <div class="lab">工種</div>${chips("ew_"+id,wo,w)}
    <div class="lab">指摘箇所の写真を差し替える（差し替える場合のみ）</div>${camButtons("data-editcam",id)}<div class="edit-prev"></div>
    <div class="row"><button class="btn btn-primary" data-es="${esc(id)}">この内容で修正保存</button></div>
  </details>`;
}
function bindEditor(root, recs, tn, propName, afterSave){
  const find=id=>recs.find(x=>String(x.record_id)===id)||{};
  const kikan=tn.startsWith("【検査機関】"), special=SPECIAL.includes(tn);
  const edPhoto={};
  const readForm=(box,id)=>{
    const f=(kikan||special)?(find(id).floor_level):chipVal(box,"ef_"+id), a=(kikan||special)?(find(id).area):chipVal(box,"ea_"+id);
    return {floor_level:f, area:a, issue_detail:box.querySelector(`[data-ed="${id}"]`).value.trim(), work_type:chipVal(box,"ew_"+id)};
  };
  root.querySelectorAll("[data-editcam]").forEach(inp=>inp.onchange=async e=>{
    const id=inp.dataset.editcam, f=e.target.files[0]; if(!f) return;
    const box=inp.closest(".rec"), prev=box.querySelector(".edit-prev");
    prev.innerHTML=`<div class="info">写真を処理中…</div>`;
    try{
      const v=readForm(box,id);
      const board={propName, inspType:tn, inspDate:todayStr(), locationText:`${v.floor_level||""} ${v.area||""}`.trim(), issueDetail:cut80(v.issue_detail)};
      const set=await makePhotoSet(f,board,"insp");
      if(edPhoto[id]) URL.revokeObjectURL(edPhoto[id].url);
      edPhoto[id]={...set,url:URL.createObjectURL(set.full)};
      prev.innerHTML=`<img class="pic s" src="${edPhoto[id].url}" alt="差し替えプレビュー">`;
    }catch(err){ prev.innerHTML=`<div class="err">写真を読み込めませんでした。もう一度お試しください。</div>`; }
  });
  root.querySelectorAll("[data-es]").forEach(btn=>btn.onclick=async()=>{
    const id=btn.dataset.es, box=btn.closest(".rec");
    const body=readForm(box,id);
    if(!body.issue_detail){ toast("指摘内容を入力してください",false); return; }
    spinBtn(btn,"保存中…");
    try{
      const ep=edPhoto[id];
      if(ep){
        const base=uuid();
        body.issue_photo_url=await upload(ep.full,`${base}.jpg`);
        body.issue_photo_thumb_url=body.issue_photo_url;
        try{ body.issue_photo_thumb_url=await upload(ep.thumb,`${base}_thumb.jpg`); }catch(e){}
      }
      await spatch("inspection_records","record_id",id,body);
      if(ep){ URL.revokeObjectURL(ep.url); delete edPhoto[id]; }
      toast("修正を保存しました"); afterSave();
    }catch(err){ unspinBtn(btn); toast("修正の保存に失敗しました。もう一度押してください",false); }
  });
}

// ---- 物件変更（間違えて登録した検査のお引越し）----
function moveHtml(others){
  return `<details class="sub"><summary>🔄 この検査の物件を変更する（間違えて登録した場合）</summary>
    <div class="info warn">※この検査に含まれるすべての写真と指摘データを、別の物件に移動させます。</div>
    ${others.length?`<select id="mvsel">${others.map(x=>`<option value="${esc(x.property_id)}">[${esc(x.area)}] ${esc(x.property_name)}</option>`).join("")}</select>
      <button class="btn btn-amber" id="mvbtn">この物件にデータを移動する</button>`:`<div class="info">他に移動できる物件がありません。</div>`}</details>`;
}
function bindMove(others, ids, done){
  const b=$("#mvbtn"); if(!b) return;
  b.onclick=async()=>{
    const np=others.find(x=>String(x.property_id)===$("#mvsel").value);
    if(!np||!confirm(`「${np.property_name}」へこの検査のデータをすべて移動します。よろしいですか？`)) return;
    spinBtn(b,"移動中…");
    try{
      for(const id of ids){
        await spatch("inspections","inspection_id",id,{property_id:np.property_id,property_name:np.property_name});
        await spatch("inspection_records","inspection_id",id,{property_id:np.property_id});
      }
      toast(`「${np.property_name}」へ移動が完了しました`); done();
    }catch(e){ unspinBtn(b); toast("移動に失敗しました。時間をおいて再試行してください",false); }
  };
}
