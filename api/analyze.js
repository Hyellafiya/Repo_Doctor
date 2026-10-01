export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
  const key=process.env.OPENROUTER_API_KEY;
  if(!key) return res.status(500).json({error:"OPENROUTER_API_KEY is not configured in Vercel."});
  try{
    const {repository,files=[],mode="quick",baseline=[]}=req.body||{};
    const model=process.env.OPENROUTER_MODEL||"openrouter/free";
    const evidence=files.map(f=>`--- FILE: ${f.path} ---\n${String(f.content||"").slice(0,12000)}`).join("\n");
    const prompt=`You are RepoDoctor, an evidence-first repository diagnostician.
Analyze ONLY the supplied repository metadata and file contents. Never invent files, vulnerabilities, dependencies, line numbers, commands already run, or facts not supported by evidence.
Mode: ${mode}
Return STRICT JSON only:
{"score":0,"summary":"","issues":[{"severity":"danger|warning|info","category":"SECURITY|TESTING|DOCS|CODE|CONFIG|DEPENDENCIES|ARCHITECTURE|PERFORMANCE","title":"","explanation":"","fix":"","file":"","evidence":"","confidence":"High|Medium|Low"}]}
Score from 0-100. Be conservative. Prefer actionable findings. Security claims require concrete evidence.
Repository: ${JSON.stringify(repository)}
Baseline signals: ${JSON.stringify(baseline)}
Files:
${evidence}`;
    const r=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${key}`,"Content-Type":"application/json","HTTP-Referer":process.env.NEXT_PUBLIC_APP_URL||"https://repodoctor-five.vercel.app","X-Title":"RepoDoctor"},body:JSON.stringify({model,messages:[{role:"user",content:prompt}],temperature:.1,max_tokens:4500})});
    const raw=await r.text();if(!r.ok)return res.status(502).json({error:`OpenRouter error ${r.status}: ${raw.slice(0,500)}`});
    const data=JSON.parse(raw);let text=data?.choices?.[0]?.message?.content||"";
    text=text.replace(/^```json\s*/i,"").replace(/```$/,"").trim();
    const parsed=JSON.parse(text);
    return res.status(200).json(parsed);
  }catch(e){return res.status(500).json({error:"Diagnosis service failed: "+e.message})}
}