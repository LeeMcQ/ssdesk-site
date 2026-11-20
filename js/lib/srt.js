export function srtToVtt(r){const t=String(r||"").replace(/\r/g,"").trim();return/^WEBVTT/.test(t)?t:`WEBVTT

`+t.split(/\n\s*\n/).map(i=>{const n=i.split(`
`);return/^\d+$/.test(n[0].trim())&&n.shift(),n[0]&&(n[0]=n[0].replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g,"$1.$2")),n.join(`
`)}).join(`

`)+`
`}
