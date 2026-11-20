export function htmlLines(e){const n=document.createElement("template");return n.innerHTML=String(e||""),n.content.querySelectorAll("br").forEach(t=>t.replaceWith(`
`)),n.content.querySelectorAll(".ln").forEach(t=>t.append(`
`)),n.content.querySelectorAll(".hn").forEach(t=>t.append(" ")),n.content.querySelectorAll(".ha").forEach(t=>t.prepend(`
`)),n.content.querySelectorAll("sup, .vn").forEach(t=>t.replaceWith(" "+t.textContent.trim()+"\xA0")),n.content.querySelectorAll("p,div,li,h1,h2,h3,h4").forEach(t=>t.append(`
`)),n.content.textContent.split(`
`).map(t=>t.replace(/\s+/g," ").trim()).join(`
`).replace(/\n{3,}/g,`

`).trim()}export function frameText(e){if(!e)return"";if(e.kind==="text"){const n=[];return e.cols&&e.cols.length?e.cols.forEach(t=>n.push(htmlLines(t.html))):n.push(htmlLines(e.html)),n.filter(Boolean).join(`

`)}return e.kind==="banner"?[e.kicker,e.title,e.text].filter(Boolean).join(`
`):e.kind==="html"?htmlLines(e.html).slice(0,600):""}export function frameRef(e){return e&&e.kind==="text"?[e.foot,e.footR].filter(Boolean).join(" \xB7 "):""}
