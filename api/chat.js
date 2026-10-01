export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
  const key=String(process.env.OPENROUTER_API_KEY||"").replace(/[\u200B-\u200D\u200E\u200F\uFEFF]/g,"").trim();
  if(!key) return res.status(500).json({error:"OPENROUTER_API_KEY is not configured in Vercel."});
  try{
    const {question,repository,findings=[],files=[]}=req.body||{};
    if(!question)return res.status(400).json({error:"Question is required."});
    const model=process.env.OPENROUTER_MODEL||"openrouter/free";
    const context=files.slice(0,8).map(f=>`FILE ${f.path}:\n${String(f.content||"").slice(0,5000)}`).join("\n\n");
    const prompt=`You are RepoDoctor Quick Help. Give concise, practical developer guidance using ONLY this supplied repository context and diagnosis. Do not invent line numbers or files.
Repository: ${JSON.stringify(repository)}
Findings: ${JSON.stringify(findings.slice(0,12))}
Files:
${context}
User question: ${question}`;
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
    let r;
    try{
      r=await fetch("https://openrouter.ai/api/v1/chat/completions",{
        method:"POST",signal:controller.signal,
        headers:{"Authorization":`Bearer ${key}`,"Content-Type":"application/json","HTTP-Referer":process.env.NEXT_PUBLIC_APP_URL||"https://repodoctor-five.vercel.app","X-Title":"RepoDoctor"},
        body:JSON.stringify({model,messages:[{role:"user",content:prompt}],temperature:.2,max_tokens:900})
      });
    }catch(e){
      if(e.name==="AbortError")return res.status(200).json({answer:"The AI helper timed out. Please try again in a moment."});
      throw e;
    }finally{clearTimeout(timer)}
    const raw=await r.text();
    if(!r.ok)return res.status(502).json({error:`OpenRouter returned ${r.status}. ${raw.slice(0,350)}`});
    const data=JSON.parse(raw);return res.status(200).json({answer:data?.choices?.[0]?.message?.content||"No answer returned."});
  }catch(e){return res.status(500).json({error:"AI help failed: "+e.message})}
}