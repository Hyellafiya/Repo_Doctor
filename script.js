(() => {
"use strict";
const $ = id => document.getElementById(id);
const state = { repo:null, files:[], findings:[], score:null, summary:"", stack:[], tree:[] };

function setStatus(s){ $("status").textContent=s; }
function showError(msg){ $("errorBox").textContent=msg; $("errorBox").classList.remove("hidden"); }
function clearError(){ $("errorBox").classList.add("hidden"); $("errorBox").textContent=""; }
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

function parseRepo(url){
  try{
    const u=new URL(url.trim());
    if(u.hostname!=="github.com") throw new Error("Use a github.com repository URL.");
    const parts=u.pathname.split("/").filter(Boolean);
    if(parts.length<2) throw new Error("That does not look like a GitHub repository URL.");
    return {owner:parts[0],name:parts[1].replace(/\.git$/,"")};
  }catch(e){throw new Error(e.message||"Enter a valid public GitHub repository URL.");}
}

async function github(path){
  const r=await fetch("https://api.github.com"+path,{headers:{Accept:"application/vnd.github+json"}});
  if(!r.ok) throw new Error(`GitHub returned ${r.status}. Make sure the repository is public and the URL is correct.`);
  return r.json();
}
function baseFindings(files){
  const names=files.map(f=>f.path.toLowerCase()), out=[];
  if(!names.some(n=>n.endsWith("readme.md")||n.endsWith("readme")) ) out.push({severity:"warning",category:"DOCS",title:"README documentation is missing",explanation:"No README file was found in the scanned repository.",fix:"Add a README explaining setup, usage, architecture and contribution steps.",file:"",evidence:"No README path was present in the repository tree.",confidence:"High"});
  if(!names.some(n=>/(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\./.test(n))) out.push({severity:"warning",category:"TESTING",title:"No obvious automated tests detected",explanation:"The scanned tree does not contain common test folders or test/spec filenames.",fix:"Add focused unit or integration tests for the most important behavior.",file:"",evidence:"No common test path or filename pattern was found.",confidence:"Medium"});
  if(names.some(n=>n.includes(".env")) && !names.some(n=>n.includes(".env.example"))) out.push({severity:"warning",category:"SECURITY",title:"Environment configuration may need documentation",explanation:"An environment file exists without an obvious example template.",fix:"Keep secrets out of Git and document required variables in .env.example.",file:"",evidence:names.filter(n=>n.includes(".env")).join(", "),confidence:"Medium"});
  if(!names.some(n=>/(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|pipfile\.lock|cargo\.lock|composer\.lock)$/.test(n)) && names.some(n=>/\.(js|ts|tsx|jsx)$/.test(n))) out.push({severity:"info",category:"DEPENDENCIES",title:"No JavaScript lockfile detected",explanation:"JavaScript/TypeScript files are present but no common JS lockfile was found.",fix:"Commit the lockfile used by the project so installs are reproducible.",file:"",evidence:"No package-lock.json, yarn.lock or pnpm-lock.yaml found.",confidence:"Medium"});
  return out;
}
async function scan(){
  clearError();
  const raw=$("repoUrl").value.trim();
  let repo;
  try{repo=parseRepo(raw)}catch(e){showError(e.message);return;}
  $("diagnoseBtn").disabled=true; $("diagnoseBtn").textContent="Examining…"; setStatus("Reading repository metadata…");
  try{
    const meta=await github(`/repos/${repo.owner}/${repo.name}`);
    if(meta.private) throw new Error("This repository is private. RepoDoctor currently scans public repositories only.");
    setStatus("Mapping repository structure…");
    const treeData=await github(`/repos/${repo.owner}/${repo.name}/git/trees/${encodeURIComponent(meta.default_branch||"main")}?recursive=1`);
    const tree=(treeData.tree||[]).filter(x=>x.type==="blob"&&!/(^|\/)(node_modules|\.git)(\/|$)/.test(x.path));
    const priority=/^(readme|package\.json|requirements\.txt|pyproject\.toml|pubspec\.yaml|cargo\.toml|go\.mod|vercel\.json|tsconfig\.json|next\.config|vite\.config)/i;
    const selected=tree.filter(x=>priority.test(x.path.split("/").pop())).concat(tree.filter(x=>!priority.test(x.path.split("/").pop())).slice(0,20)).slice(0,24);
    setStatus(`Reading ${selected.length} files…`);
    const files=[];
    for(const f of selected){
      try{
        const d=await github(`/repos/${repo.owner}/${repo.name}/contents/${f.path}`);
        if(d.encoding==="base64"&&d.content) files.push({path:f.path,content:decodeBase64(d.content).slice(0,12000)});
      }catch{}
    }
    const baseline=baseFindings(files);
    setStatus("Sending evidence to RepoDoctor AI…");
    const ai=await postJSON("/api/analyze",{repository:{owner:repo.owner,name:repo.name,description:meta.description,default_branch:meta.default_branch,language:meta.language,stars:meta.stargazers_count},files,mode:$("scanMode").value,baseline});
    state.repo={...repo,...meta}; state.files=files; state.tree=tree.map(x=>x.path); state.findings=dedupe([...baseline,...(ai.issues||[])]); state.score=Number.isFinite(ai.score)?ai.score:scoreFrom(state.findings); state.summary=ai.summary||"Diagnosis generated from the scanned repository evidence.";
    state.stack=detectStack(files,meta); render();
    localStorage.setItem("repodoctor:last",JSON.stringify({url:raw,score:state.score,repo:state.repo,findings:state.findings,summary:state.summary,stack:state.stack,tree:state.tree,files:state.files}));
    setStatus("Diagnosis complete.");
  }catch(e){showError(e.message||"The diagnosis failed. Check your Vercel deployment and environment variable.");setStatus("Diagnosis failed.");}
  finally{$("diagnoseBtn").disabled=false;$("diagnoseBtn").textContent="🩺 Diagnose";}
}
function decodeBase64(s){try{const bin=atob(s.replace(/\s/g,""));const bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));return new TextDecoder().decode(bytes)}catch{return atob(s)}}
async function postJSON(url,body){
  const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  let d={};try{d=await r.json()}catch{}
  if(!r.ok) throw new Error(d.error||`Server error ${r.status}.`);
  return d;
}
function dedupe(arr){const seen=new Set();return arr.filter(x=>{const k=[x.category,x.title,x.file].join("|");if(seen.has(k))return false;seen.add(k);return true}).slice(0,30)}
function scoreFrom(fs){let s=100;for(const f of fs)s-=f.severity==="danger"?18:f.severity==="warning"?8:2;return Math.max(0,Math.min(100,s))}
function detectStack(files,meta){
  const n=files.map(f=>f.path.toLowerCase()), s=[];
  if(meta.language)s.push(meta.language);
  if(n.includes("package.json"))s.push("Node.js");
  if(n.some(x=>x.endsWith(".tsx")||x.endsWith(".ts")))s.push("TypeScript");
  if(n.some(x=>x.includes("next.config")))s.push("Next.js");
  if(n.some(x=>x.includes("vite.config")))s.push("Vite");
  if(n.some(x=>x.includes("requirements.txt")||x.endsWith("pyproject.toml")))s.push("Python");
  if(n.some(x=>x.includes("pubspec.yaml")))s.push("Flutter/Dart");
  return [...new Set(s)];
}
function render(){
  $("emptyState").classList.add("hidden");$("report").classList.remove("hidden");$("rescanBtn").classList.remove("hidden");
  $("score").textContent=state.score; $("summary").textContent=state.summary;
  $("repoName").textContent=state.repo.full_name||`${state.repo.owner}/${state.repo.name}`;
  $("repoMeta").textContent=`${state.repo.default_branch||"main"} · ${state.repo.language||"Unknown language"}`;
  const danger=state.findings.filter(f=>f.severity==="danger").length,warn=state.findings.filter(f=>f.severity==="warning").length;
  $("dangerCount").textContent=danger;$("warnCount").textContent=warn;$("passCount").textContent=Math.max(0,8-danger-warn);$("fileCount").textContent=state.files.length;
  $("scoreRing").style.borderColor=state.score<50?"var(--danger)":state.score<75?"var(--warn)":"var(--accent)";
  const counts={};state.findings.forEach(f=>counts[f.category]=(counts[f.category]||0)+1);
  $("categories").innerHTML=Object.keys(counts).length?Object.entries(counts).map(([k,v])=>`<span class="chip">${esc(k)} · ${v}</span>`).join(""):`<span class="chip">No major signals</span>`;
  $("priority").innerHTML=state.findings.filter(f=>f.severity!=="info").slice(0,4).map(f=>`<li>${esc(f.title)}</li>`).join("")||"<li>No priority findings.</li>";
  $("findings").innerHTML=state.findings.map((f,i)=>`<article class="finding ${esc(f.severity)}"><div class="findingHead"><span class="findingTitle">${i+1}. ${esc(f.title)}</span><span class="badge">${esc(f.category)} · ${esc(f.confidence||"Medium")}</span></div><p>${esc(f.explanation)}</p>${f.file?`<div class="evidence"><strong>File:</strong> <code>${esc(f.file)}</code></div>`:""}${f.evidence?`<div class="evidence"><strong>Evidence:</strong> ${esc(f.evidence)}</div>`:""}${f.fix?`<div class="fix"><strong>Prescription:</strong> ${esc(f.fix)}</div>`:""}</article>`).join("")||`<div class="card">No issues were returned for the scanned evidence.</div>`;
  $("stack").innerHTML=state.stack.map(x=>`<span class="chip">${esc(x)}</span>`).join("")||'<span class="chip">Unknown</span>';
  $("tree").textContent=state.tree.slice(0,45).join("\n")+(state.tree.length>45?`\n… ${state.tree.length-45} more files`:"");
}
function sample(){
  state.repo={full_name:"demo/healthy-repo",default_branch:"main",language:"JavaScript"};state.files=[{path:"README.md",content:"# Demo"}];state.tree=["README.md","package.json","src/app.js","tests/app.test.js"];state.stack=["JavaScript","Node.js"];state.score=84;state.summary="Demo report only. Scan your own public repository for a real diagnosis.";state.findings=[{severity:"warning",category:"TESTING",title:"Test coverage could be expanded",explanation:"The demo repository has tests, but the critical path is only lightly covered.",fix:"Add tests around validation and error handling.",file:"tests/app.test.js",evidence:"Demo evidence — not a real repository finding.",confidence:"Low"}];render();setStatus("Demo report loaded.");}
function clearReport(){localStorage.removeItem("repodoctor:last");location.hash="diagnosis";location.reload()}
function reportText(){return `RepoDoctor Diagnosis\nRepository: ${state.repo?.full_name||"—"}\nHealth score: ${state.score}/100\nSummary: ${state.summary}\n\nFindings:\n`+state.findings.map((f,i)=>`${i+1}. [${f.severity}] ${f.title}\nCategory: ${f.category}\n${f.explanation}\nEvidence: ${f.evidence||"—"}\nPrescription: ${f.fix||"—"}\n`).join("\n")}
async function copyText(t){try{await navigator.clipboard.writeText(t);return true}catch{const ta=document.createElement("textarea");ta.value=t;document.body.appendChild(ta);ta.select();const ok=document.execCommand("copy");ta.remove();return ok}}
async function share(){
  const data={title:"RepoDoctor",text:"Check out RepoDoctor — AI-powered GitHub repository diagnosis.",url:location.href};
  if(navigator.share){try{await navigator.share(data);return}catch(e){if(e.name==="AbortError")return}}
  const ok=await copyText(location.href);alert(ok?"RepoDoctor link copied to your clipboard.":"Could not copy automatically. Please copy the page URL from your browser.");
}
function openDrawer(){ $("drawer").classList.add("open");$("drawer").setAttribute("aria-hidden","false");$("drawerBackdrop").classList.remove("hidden");$("menuBtn").setAttribute("aria-expanded","true")}
function closeDrawer(){ $("drawer").classList.remove("open");$("drawer").setAttribute("aria-hidden","true");$("drawerBackdrop").classList.add("hidden");$("menuBtn").setAttribute("aria-expanded","false")}
async function sendChat(){
  const q=$("chatInput").value.trim();if(!q)return;
  $("chatMessages").insertAdjacentHTML("beforeend",`<div class="msg user">${esc(q)}</div>`);$("chatInput").value="";
  const waiting=document.createElement("div");waiting.className="msg ai";waiting.textContent="Thinking…";$("chatMessages").appendChild(waiting);$("chatMessages").scrollTop=$("chatMessages").scrollHeight;
  try{
    if(!state.repo) throw new Error("Run a diagnosis first.");
    const d=await postJSON("/api/chat",{question:q,repository:{full_name:state.repo.full_name,language:state.repo.language},findings:state.findings,files:state.files.slice(0,12)});
    waiting.textContent=d.answer||"No answer returned.";
  }catch(e){waiting.textContent=e.message}
}
$("diagnoseBtn").addEventListener("click",scan);
$("repoUrl").addEventListener("keydown",e=>{if(e.key==="Enter")scan()});
$("rescanBtn").addEventListener("click",scan);
$("shareBtn").addEventListener("click",share);
$("nativeShareBtn").addEventListener("click",share);
$("copyLinkBtn").addEventListener("click",async()=>{alert(await copyText(location.href)?"Link copied.":"Copy failed.");closeDrawer()});
$("sampleBtn").addEventListener("click",()=>{sample();closeDrawer()});
$("clearBtn").addEventListener("click",()=>{closeDrawer();clearReport()});
$("menuBtn").addEventListener("click",openDrawer);$("closeDrawer").addEventListener("click",closeDrawer);$("drawerBackdrop").addEventListener("click",closeDrawer);
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeDrawer()});
$("copyReportBtn").addEventListener("click",async()=>alert(await copyText(reportText())?"Report copied.":"Copy failed."));
$("exportBtn").addEventListener("click",()=>{const blob=new Blob([reportText()],{type:"text/markdown"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="repodoctor-report.md";a.click();URL.revokeObjectURL(a.href)});
$("chatSend").addEventListener("click",sendChat);$("chatInput").addEventListener("keydown",e=>{if(e.key==="Enter")sendChat()});
document.querySelectorAll(".quickPrompts button").forEach(b=>b.addEventListener("click",()=>{$("chatInput").value=b.dataset.q;sendChat()}));
(async()=>{try{const last=JSON.parse(localStorage.getItem("repodoctor:last")||"null");if(last){Object.assign(state,last);render();setStatus("Previous diagnosis restored locally.")}}catch{}})();
})();