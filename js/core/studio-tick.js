let t=0;self.onmessage=s=>{clearInterval(t);const e=+s.data||0;e>0&&(t=setInterval(()=>self.postMessage(0),1e3/e))};
