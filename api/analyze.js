export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
  const key=String(process.env.OPENROUTER_API_KEY||"").replace(/[\u200B-\u200D\u200E\u200F\uFEFF]/g,"").trim();
  if(!key) return res.status(500).json({error:"OPENROUTER_API_KEY is not configured in Vercel."});
  try{
    const {repository,files=[],mode="quick",baseline=[]}=req.body||{};
    const model=process.env.OPENROUTER_MODEL||"openrouter/free";
    const evidence=files.slice(0,14).map(f=>`--- FILE: ${f.path} ---\n${String(f.content||"").slice(0,7000)}`).join("\n");
    const prompt=`You are RepoDoctor, an evidence-first repository diagnostician.
Analyze ONLY the supplied repository metadata and file contents. Never invent files, vulnerabilities, dependencies, line numbers, or facts not supported by evidence.
Mode: ${mode}
Return STRICT JSON only:
{"score":0,"summary":"","issues":[{"severity":"danger|warning|info","category":"SECURITY|TESTING|DOCS|CODE|CONFIG|DEPENDENCIES|ARCHITECTURE|PERFORMANCE","title":"","explanation":"","fix":"","file":"","evidence":"","confidence":"High|Medium|Low"}]}
Score from 0-100. Be conservative and actionable. Security claims require concrete evidence.
Repository: ${JSON.stringify(repository)}
Baseline signals: ${JSON.stringify(baseline)}
Files:
${evidence}`;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),22000);
    let r;
    try{
      r=await fetch("https://openrouter.ai/api/v1/chat/completions",{
        method:"POST",signal:controller.signal,
        headers:{
          "Authorization":`Bearer ${key}`,
          "Content-Type":"application/json",
          "HTTP-Referer":process.env.NEXT_PUBLIC_APP_URL||"https://repodoctor-five.vercel.app",
          "X-Title":"RepoDoctor"
        },
        body:JSON.stringify({model,messages:[{role:"user",content:prompt}],temperature:.1,max_tokens:2200})
      });
    }catch(e){
      if(e.name==="AbortError"){
        const score=Math.max(0,100-baseline.filter(x=>x.severity==="danger").length*18-baseline.filter(x=>x.severity==="warning").length*8);
        return res.status(200).json({score,summary:"AI analysis timed out. RepoDoctor returned the local checks so you can still review the repository.",issues:baseline,aiTimedOut:true});
      }
      throw e;
    }finally{clearTimeout(timer)}
    const raw=await r.text();
    if(!r.ok)return res.status(502).json({error:`OpenRouter returned ${r.status}. ${raw.slice(0,350)}`});
    const data=JSON.parse(raw);
    let text=data?.choices?.[0]?.message?.content||"";
    text=text.replace(/^```json\s*/i,"").replace(/```$/,"").trim();
    try{return res.status(200).json(JSON.parse(text))}
    catch{return res.status(200).json({score:Math.max(0,100-baseline.length*5),summary:"The AI response could not be parsed, so RepoDoctor returned the local checks.",issues:baseline,aiParseFailed:true})}
  }catch(e){return res.status(500).json({error:"Diagnosis service failed: "+e.message})}
}