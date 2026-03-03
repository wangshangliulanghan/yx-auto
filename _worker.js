// Cloudflare Worker - 终极融合版 (智能排序 + 边缘缓存 + 纯净443大厂域名)
// 结合了：Colo偏好/ms排序/Top截断 + 强制443 TLS + 高权重免测速域名 + Edge Cache

const EDGE_CACHE_TTL_HOME = 60 * 60 * 6;        
const EDGE_CACHE_TTL_SUB = 60 * 5;              
const EDGE_CACHE_TTL_UPSTREAM = 60 * 10;        
const EDGE_CACHE_SWR_HOME = 60 * 60;            
const EDGE_CACHE_SWR_SUB = 60 * 10;             
const EDGE_CACHE_SWR_UPSTREAM = 60 * 10;        

function withCacheHeaders(resp, sMaxAge, swr = 0) {
  const r = new Response(resp.body, resp);
  r.headers.set("Cache-Control", `public, max-age=0, s-maxage=${sMaxAge}${swr ? `, stale-while-revalidate=${swr}` : ""}`);
  return r;
}

async function edgeCacheGet(cacheKey) { try { return await caches.default.match(cacheKey); } catch { return null; } }
async function edgeCachePut(cacheKey, response) { try { await caches.default.put(cacheKey, response.clone()); } catch {} }
function makeCacheKey(urlStr) { return new Request(urlStr, { method: "GET" }); }
async function cachedGetText(cacheKey) { const cached = await edgeCacheGet(cacheKey); if (!cached) return null; try { return await cached.text(); } catch { return null; } }
async function cachedSetText(cacheKey, text, ttl = EDGE_CACHE_TTL_UPSTREAM, swr = EDGE_CACHE_SWR_UPSTREAM) {
  const resp = withCacheHeaders(new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } }), ttl, swr);
  await edgeCachePut(cacheKey, resp);
}
async function cachedGetJSON(cacheKey) { const cached = await edgeCacheGet(cacheKey); if (!cached) return null; try { return await cached.json(); } catch { return null; } }
async function cachedSetJSON(cacheKey, obj, ttl = EDGE_CACHE_TTL_UPSTREAM, swr = EDGE_CACHE_SWR_UPSTREAM) {
  const resp = withCacheHeaders(new Response(JSON.stringify(obj), { headers: { "Content-Type": "application/json; charset=utf-8" } }), ttl, swr);
  await edgeCachePut(cacheKey, resp);
}

// 默认配置
let customPreferredIPs = [];
let customPreferredDomains = [];
let epd = true;  
let epi = true;  
let egi = true;  
let ev = true;   
let et = false;  
let vm = false;  
let scu = 'https://url.v1.mk/sub';  
let enableECH = false;
let customDNS = 'https://dns.joeyblog.eu.org/joeyblog';
let customECHDomain = 'cloudflare-ech.com';

// ⭐️ 强力CDN优化：高权重免测速域名池 (自动解析健康IP，避免死IP导致-1)
const directDomains = [
  { name: "🚀 SG-Visa官方", domain: "www.visa.com.sg" },
  { name: "🚀 JP-Glassdoor", domain: "www.glassdoor.com" },
  { name: "🚀 HK-Time官方", domain: "time.is" },
  { name: "🚀 TW-iCook", domain: "icook.tw" },
  { name: "⚡️ 全球-CF测速", domain: "speed.cloudflare.com" },
  { name: "🌐 社区优选-SKK", domain: "cf.skk.moe" }
];

const defaultIPURL = 'https://raw.githubusercontent.com/ymyuuu/IPDB/main/bestcf.txt';

function isValidUUID(str) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str); }

async function fetchDynamicIPs(ipv4Enabled = true, ipv6Enabled = true, ispMobile = true, ispUnicom = true, ispTelecom = true) {
  const v4Url = "https://www.wetest.vip/page/cloudflare/address_v4.html";
  const v6Url = "https://www.wetest.vip/page/cloudflare/address_v6.html";
  let results = [];
  try {
    const fetchPromises = [];
    if (ipv4Enabled) fetchPromises.push(fetchAndParseWetest(v4Url));
    if (ipv6Enabled) fetchPromises.push(fetchAndParseWetest(v6Url));
    const [ipv4List, ipv6List] = await Promise.all(fetchPromises);
    results = [...(ipv4List||[]), ...(ipv6List||[])];
    if (results.length > 0) {
      results = results.filter(item => {
        const isp = item.isp || '';
        if (isp.includes('移动') && !ispMobile) return false;
        if (isp.includes('联通') && !ispUnicom) return false;
        if (isp.includes('电信') && !ispTelecom) return false;
        return true;
      });
    }
    return results.length > 0 ? results : [];
  } catch (e) { return []; }
}

async function fetchAndParseWetest(url) {
  try {
    const cacheKey = makeCacheKey(url + (url.includes('?') ? '&' : '?') + '__cf_cache=wetest');
    const cached = await cachedGetJSON(cacheKey);
    if (cached) return cached;
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) return [];
    const html = await response.text();
    const results = [];
    const rowRegex = /<tr[\s\S]*?<\/tr>/g;
    const cellRegex = /<td data-label="线路名称">(.+?)<\/td>[\s\S]*?<td data-label="优选地址">([\d.:a-fA-F]+)<\/td>[\s\S]*?<td data-label="数据中心">(.+?)<\/td>/;
    let match;
    while ((match = rowRegex.exec(html)) !== null) {
      const cellMatch = match[0].match(cellRegex);
      if (cellMatch && cellMatch[1] && cellMatch[2]) {
        results.push({ isp: cellMatch[1].trim().replace(/<.*?>/g, ''), ip: cellMatch[2].trim(), colo: cellMatch[3] ? cellMatch[3].trim().replace(/<.*?>/g, '') : '' });
      }
    }
    await cachedSetJSON(cacheKey, results, EDGE_CACHE_TTL_UPSTREAM, EDGE_CACHE_SWR_UPSTREAM);
    return results;
  } catch (error) { return []; }
}

async function 整理成数组(内容) {
  var 替换后的内容 = 内容.replace(/[\t"'\r\n]+/g, ',').replace(/,+/g, ',');
  if (替换后的内容.charAt(0) == ',') 替换后的内容 = 替换后的内容.slice(1);
  if (替换后的内容.charAt(替换后的内容.length - 1) == ',') 替换后的内容 = 替换后的内容.slice(0, 替换后的内容.length - 1);
  return 替换后的内容.split(',');
}

async function 请求优选API(urls, 超时时间 = 3000) {
  if (!urls?.length) return [];
  const results = new Set();
  await Promise.allSettled(urls.map(async (url) => {
    try {
      const cacheKeyStr = url + (url.includes('?') ? '&' : '?') + `__cf_cache=optapi&port=443`;
      const cacheKey = makeCacheKey(cacheKeyStr);
      let text = await cachedGetText(cacheKey);
      if (!text) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 超时时间);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        const buffer = await response.arrayBuffer();
        text = new TextDecoder('utf-8').decode(buffer);
        await cachedSetText(cacheKey, text, EDGE_CACHE_TTL_UPSTREAM, EDGE_CACHE_SWR_UPSTREAM);
      }
      const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l);
      const isCSV = lines.length > 1 && lines[0].includes(',');
      const IPV6_PATTERN = /^[^\[\]]*:[^\[\]]*:[^\[\]]/;
      if (!isCSV) {
        lines.forEach(line => {
          const hashIndex = line.indexOf('#');
          const hostPart = hashIndex > -1 ? line.substring(0, hashIndex) : line;
          const remark = hashIndex > -1 ? line.substring(hashIndex) : '';
          let cleanHost = hostPart.startsWith('[') ? hostPart.substring(0, hostPart.indexOf(']') + 1) : hostPart.split(':')[0];
          results.add(`${cleanHost}:443${remark}`);
        });
      } else {
        const headers = lines[0].split(',').map(h => h.trim());
        const ipIdx = headers.findIndex(h => h.includes('IP地址') || h.includes('IP'));
        const delayIdx = headers.findIndex(h => h.includes('延迟'));
        const speedIdx = headers.findIndex(h => h.includes('下载速度'));
        lines.slice(1).forEach(line => {
          const cols = line.split(',').map(c => c.trim());
          if (cols[ipIdx]) {
            const wrappedIP = IPV6_PATTERN.test(cols[ipIdx]) ? `[${cols[ipIdx]}]` : cols[ipIdx];
            let remark = "#优选节点";
            if(delayIdx > -1 && speedIdx > -1) remark = `#延迟${cols[delayIdx]}ms 速度${cols[speedIdx]}MB/s`;
            results.add(`${wrappedIP.replace(/[\[\]]/g, '')}:443${remark}`);
          }
        });
      }
    } catch (e) { }
  }));
  return Array.from(results);
}

async function fetchAndParseNewIPs(piu) {
  const url = piu || defaultIPURL;
  try {
    const cacheKey = makeCacheKey(url + (url.includes('?') ? '&' : '?') + '__cf_cache=githubip');
    let text = await cachedGetText(cacheKey);
    if (!text) {
      const response = await fetch(url);
      if (!response.ok) return [];
      text = await response.text();
      await cachedSetText(cacheKey, text, EDGE_CACHE_TTL_UPSTREAM, EDGE_CACHE_SWR_UPSTREAM);
    }
    const results = [];
    const lines = text.trim().replace(/\r/g, "").split('\n');
    for (const line of lines) {
      const match = line.trim().match(/^([^:]+):(\d+)#(.*)$/);
      if (match) results.push({ ip: match[1], port: 443, name: match[3].trim() || match[1] });
    }
    return results;
  } catch (error) { return []; }
}

// ⭐️ 核心：全部端口锁定为 443，避免 80 端口被 QOS
function generateLinksFromSource(list, user, workerDomain, disableNonTLS, customPath, echConfig) {
  const links = [];
  list.forEach(item => {
    let nodeNameBase = item.isp ? item.isp.replace(/\s/g, '_') : (item.name || item.domain || item.ip);
    if (item.colo && item.colo.trim()) nodeNameBase = `${nodeNameBase}-${item.colo.trim()}`;
    const safeIP = item.ip.includes(':') ? `[${item.ip}]` : item.ip;
    const wsParams = new URLSearchParams({ encryption: 'none', security: 'tls', sni: workerDomain, fp: 'chrome', type: 'ws', host: workerDomain, path: customPath || '/' });
    if (echConfig) { wsParams.set('alpn', 'h3,h2,http/1.1'); wsParams.set('ech', echConfig); }
    links.push(`vless://${user}@${safeIP}:443?${wsParams.toString()}#${encodeURIComponent(nodeNameBase + '-443-TLS')}`);
  });
  return links;
}

async function generateTrojanLinksFromSource(list, user, workerDomain, disableNonTLS, customPath, echConfig) {
  const links = [];
  list.forEach(item => {
    let nodeNameBase = item.isp ? item.isp.replace(/\s/g, '_') : (item.name || item.domain || item.ip);
    const safeIP = item.ip.includes(':') ? `[${item.ip}]` : item.ip;
    const wsParams = new URLSearchParams({ security: 'tls', sni: workerDomain, fp: 'chrome', type: 'ws', host: workerDomain, path: customPath || '/' });
    if (echConfig) { wsParams.set('alpn', 'h3,h2,http/1.1'); wsParams.set('ech', echConfig); }
    links.push(`trojan://${user}@${safeIP}:443?${wsParams.toString()}#${encodeURIComponent(nodeNameBase + '-443-Trojan')}`);
  });
  return links;
}

function generateVMessLinksFromSource(list, user, workerDomain, disableNonTLS, customPath, echConfig) {
  const links = [];
  list.forEach(item => {
    let nodeNameBase = item.isp ? item.isp.replace(/\s/g, '_') : (item.name || item.domain || item.ip);
    const safeIP = item.ip.includes(':') ? `[${item.ip}]` : item.ip;
    const vmessConfig = { v: "2", ps: `${nodeNameBase}-443-VMess`, add: safeIP, port: "443", id: user, aid: "0", scy: "auto", net: "ws", type: "none", host: workerDomain, path: customPath || "/", tls: "tls", sni: workerDomain, fp: "chrome" };
    const vmessBase64 = btoa(encodeURIComponent(JSON.stringify(vmessConfig)).replace(/%([0-9A-F]{2})/g, (m, p) => String.fromCharCode('0x' + p)));
    links.push(`vmess://${vmessBase64}`);
  });
  return links;
}

function generateLinksFromNewIPs(list, user, workerDomain, customPath, echConfig) {
  return generateLinksFromSource(list, user, workerDomain, true, customPath, echConfig);
}

async function handleSubscriptionRequest(request, user, customDomain, piu, ipv4, ipv6, mob, uni, tel, ev, et, vm, dTLS, cPath, echConfig) {
  const url = new URL(request.url);
  const finalLinks = [];
  const workerDomain = url.hostname;
  const nodeDomain = customDomain || url.hostname;
  const target = url.searchParams.get('target') || 'base64';
  
  // URL参数获取排序与截断偏好
  const preferColo = (url.searchParams.get('colo') || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  const topN = Math.max(0, parseInt(url.searchParams.get('top') || '0', 10) || 0);

  function coloRankFromText(text) {
    if (!preferColo.length) return 999;
    const t = String(text || '').toLowerCase();
    const idx = preferColo.findIndex(x => t.includes(x));
    return idx === -1 ? 999 : idx;
  }
  function extractMs(text) {
    const m = String(text || '').match(/(\d+)\s*ms/i);
    return m ? parseInt(m[1], 10) : 999999;
  }
  function sortByColoAndMs(a, b) {
    const aColo = a?.colo || a?.name || a?.isp || '';
    const bColo = b?.colo || b?.name || b?.isp || '';
    const cr = coloRankFromText(aColo) - coloRankFromText(bColo);
    if (cr !== 0) return cr;
    return extractMs(aColo) - extractMs(bColo);
  }

  async function addNodesFromList(list) {
    const useVL = (ev || et || vm) ? ev : true;
    if (useVL) finalLinks.push(...generateLinksFromSource(list, user, nodeDomain, dTLS, cPath, echConfig));
    if (et) finalLinks.push(...await generateTrojanLinksFromSource(list, user, nodeDomain, dTLS, cPath, echConfig));
    if (vm) finalLinks.push(...generateVMessLinksFromSource(list, user, nodeDomain, dTLS, cPath, echConfig));
  }

  await addNodesFromList([{ ip: workerDomain, isp: '原生直连' }]);
  if (epd) await addNodesFromList(directDomains.map(d => ({ ip: d.domain, isp: d.name })));
  
  if (epi) {
    const dynamicIPList = await fetchDynamicIPs(ipv4, ipv6, mob, uni, tel);
    if (dynamicIPList.length > 0) {
      dynamicIPList.sort(sortByColoAndMs);
      await addNodesFromList(topN ? dynamicIPList.slice(0, topN) : dynamicIPList);
    }
  }

  if (egi) {
    try {
      if (piu && piu.toLowerCase().startsWith('https://')) {
        const 优选API的IP = await 请求优选API([piu]);
        let IP列表 = 优选API的IP.map(addr => {
          const match = addr.match(/^(\[[\da-fA-F:]+\]|[\d.]+|[a-zA-Z0-9.-]+)(?::(\d+))?(?:#(.+))?$/);
          if (match) return { ip: match[1].replace(/[\[\]]/g, ''), port: 443, name: match[3] || match[1] };
          return null;
        }).filter(i => i !== null);
        IP列表.sort(sortByColoAndMs);
        if (topN) IP列表 = IP列表.slice(0, topN);
        if (IP列表.length > 0) finalLinks.push(...generateLinksFromNewIPs(IP列表, user, nodeDomain, cPath, echConfig));
      } else {
        let newIPList = await fetchAndParseNewIPs(piu);
        if (topN && newIPList.length > topN) newIPList = newIPList.slice(0, topN);
        if (newIPList.length > 0) finalLinks.push(...generateLinksFromNewIPs(newIPList, user, nodeDomain, cPath, echConfig));
      }
    } catch (e) {}
  }

  // 最终总截断
  if (topN && finalLinks.length > topN) finalLinks.length = topN;

  if (finalLinks.length === 0) finalLinks.push(`vless://00000000-0000-0000-0000-000000000000@127.0.0.1:443?encryption=none&security=tls&type=ws&host=error.com&path=%2F#${encodeURIComponent('节点获取失败')}`);

  let subscriptionContent, contentType = 'text/plain; charset=utf-8';
  if (target.toLowerCase().includes('clash')) {
    subscriptionContent = generateClashConfig(finalLinks);
    contentType = 'text/yaml; charset=utf-8';
  } else if (target.toLowerCase().includes('surge')) {
    subscriptionContent = generateSurgeConfig(finalLinks);
  } else if (target.toLowerCase().includes('quanx')) {
    subscriptionContent = generateQuantumultConfig(finalLinks);
  } else {
    subscriptionContent = btoa(finalLinks.join('\n'));
  }

  return new Response(subscriptionContent, { headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } });
}

function generateClashConfig(links) {
  let yaml = 'port: 7890\nsocks-port: 7891\nallow-lan: false\nmode: rule\nlog-level: info\nproxies:\n';
  const proxyNames = [];
  links.forEach((link, index) => {
    const name = decodeURIComponent(link.split('#')[1] || `节点${index + 1}`);
    proxyNames.push(name);
    const server = link.match(/@([^:]+):/)?.[1] || '';
    const uuidMatch = link.match(/(vless|trojan):\/\/([^@]+)@/);
    const uuid = uuidMatch ? uuidMatch[2] : '';
    const type = link.startsWith('trojan') ? 'trojan' : 'vless';
    const path = link.match(/path=([^&#]+)/)?.[1] || '/';
    const host = link.match(/host=([^&#]+)/)?.[1] || '';
    const sni = link.match(/sni=([^&#]+)/)?.[1] || '';
    const echParam = link.match(/[?&]ech=([^&#]+)/)?.[1];
    const echDomain = echParam ? decodeURIComponent(echParam).split('+')[0] : '';
    
    yaml += `  - name: ${name}\n    type: ${type}\n    server: ${server}\n    port: 443\n`;
    if(type === 'vless') yaml += `    uuid: ${uuid}\n`;
    if(type === 'trojan') yaml += `    password: ${uuid}\n`;
    yaml += `    tls: true\n    network: ws\n    ws-opts:\n      path: ${path}\n      headers:\n        Host: ${host}\n`;
    if (sni) yaml += `    servername: ${sni}\n`;
    if (echDomain) yaml += `    ech-opts:\n      enable: true\n      query-server-name: ${echDomain}\n`;
  });
  yaml += '\nproxy-groups:\n  - name: PROXY\n    type: select\n';
  yaml += `    proxies: [${proxyNames.map(n => `'${n}'`).join(', ')}]\n`;
  yaml += '\nrules:\n  - DOMAIN-SUFFIX,local,DIRECT\n  - IP-CIDR,127.0.0.0/8,DIRECT\n  - GEOIP,CN,DIRECT\n  - MATCH,PROXY\n';
  return yaml;
}

function generateSurgeConfig(links) {
  let config = '[Proxy]\n';
  links.forEach(link => {
    const name = decodeURIComponent(link.split('#')[1] || '节点');
    const server = link.match(/@([^:]+):/)?.[1] || '';
    const uuidMatch = link.match(/(vless|trojan):\/\/([^@]+)@/);
    const uuid = uuidMatch ? uuidMatch[2] : '';
    const type = link.startsWith('trojan') ? 'trojan' : 'vless';
    const path = link.match(/path=([^&#]+)/)?.[1] || '/';
    const host = link.match(/host=([^&#]+)/)?.[1] || '';
    if (type === 'vless') config += `${name} = vless, ${server}, 443, username=${uuid}, tls=true, ws=true, ws-path=${path}, ws-headers=Host:${host}\n`;
    else config += `${name} = trojan, ${server}, 443, password=${uuid}, tls=true, ws=true, ws-path=${path}, ws-headers=Host:${host}\n`;
  });
  config += '\n[Proxy Group]\nPROXY = select, ' + links.map((_, i) => decodeURIComponent(links[i].split('#')[1] || `节点${i + 1}`)).join(', ') + '\n';
  return config;
}

function generateQuantumultConfig(links) { return btoa(links.join('\n')); }

function generateHomePage(scuValue) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"><title>服务器优选工具</title><style>* { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; } body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f5f5f7; color: #1d1d1f; padding: 20px; } .container { max-width: 600px; margin: 0 auto; } .header { text-align: center; padding: 30px 0; } .header h1 { font-size: 32px; font-weight: 700; margin-bottom: 8px; } .header p { font-size: 15px; color: #86868b; } .card { background: #fff; border-radius: 20px; padding: 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); margin-bottom: 20px; } .form-group { margin-bottom: 20px; } label { display: block; font-size: 13px; font-weight: 600; color: #86868b; margin-bottom: 8px; } input { width: 100%; padding: 14px; background: #f2f2f7; border: none; border-radius: 12px; font-size: 16px; outline: none; } input:focus { border: 2px solid #007AFF; padding: 12px 14px; } .list-item { display: flex; justify-content: space-between; align-items: center; padding: 16px 0; border-bottom: 1px solid #f2f2f7; cursor: pointer; } .switch { width: 51px; height: 31px; background: #e5e5ea; border-radius: 16px; position: relative; transition: 0.3s; } .switch.active { background: #34c759; } .switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 27px; height: 27px; background: #fff; border-radius: 50%; transition: 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.1); } .switch.active::after { transform: translateX(20px); } .btn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 15px; } .client-btn { padding: 12px; font-size: 13px; font-weight: 600; color: #007aff; background: rgba(0,122,255,0.1); border: none; border-radius: 10px; cursor: pointer; } .client-btn:active { background: rgba(0,122,255,0.2); } #clientSubscriptionUrl { margin-top: 15px; padding: 12px; background: #f2f2f7; border-radius: 8px; font-size: 12px; word-break: break-all; display: none; color: #007aff; }</style></head><body><div class="container"><div class="header"><h1>服务器优选工具</h1><p>智能优选 • 纯净 443 加速版</p></div><div class="card"><div class="form-group"><label>域名 (必填)</label><input type="text" id="domain" placeholder="您的Worker域名"></div><div class="form-group"><label>UUID/Password (必填)</label><input type="text" id="uuid" placeholder="您的UUID"></div><div class="form-group"><label>WS 路径 (可选)</label><input type="text" id="customPath" placeholder="默认为 /" value="/"></div><div class="form-group"><label>截断限制 (Top)</label><input type="number" id="topLimit" placeholder="为空则不限制，建议填 30-60"></div><div class="list-item" onclick="toggleSwitch('switchDomain')"><span>启用大厂免测速域名 (推荐)</span><div class="switch active" id="switchDomain"></div></div><div class="list-item" onclick="toggleSwitch('switchIP')"><span>启用动态IP源</span><div class="switch active" id="switchIP"></div></div><div class="list-item" onclick="toggleSwitch('switchGitHub')"><span>启用GitHub优选</span><div class="switch active" id="switchGitHub"></div></div><div class="btn-grid"><button class="client-btn" onclick="gen('v2ray')">复制通用订阅</button><button class="client-btn" onclick="gen('clash')">复制 Clash 订阅</button></div><div id="clientSubscriptionUrl"></div></div></div><script>let s = { switchDomain: true, switchIP: true, switchGitHub: true }; function toggleSwitch(id) { s[id] = !s[id]; document.getElementById(id).classList.toggle('active'); } function gen(t) { const d = document.getElementById('domain').value.trim(); const u = document.getElementById('uuid').value.trim(); const p = document.getElementById('customPath').value.trim() || '/'; const top = document.getElementById('topLimit').value.trim(); if(!d || !u) return alert('请先填写域名和UUID'); let link = \`\${window.location.origin}/\${u}/sub?domain=\${encodeURIComponent(d)}&epd=\${s.switchDomain?'yes':'no'}&epi=\${s.switchIP?'yes':'no'}&egi=\${s.switchGitHub?'yes':'no'}&ev=yes&path=\${encodeURIComponent(p)}\`; if(top) link += \`&top=\${top}\`; let finalUrl = link; if(t !== 'v2ray') { finalUrl = "${scu}?target=" + t + "&url=" + encodeURIComponent(link) + "&insert=false&emoji=true&list=false&new_name=true"; } document.getElementById('clientSubscriptionUrl').innerText = finalUrl; document.getElementById('clientSubscriptionUrl').style.display = 'block'; navigator.clipboard.writeText(finalUrl); alert('已生成并复制订阅链接'); }</script></body></html>`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/' || path === '') {
      const cacheKey = makeCacheKey(url.origin + "/__home__");
      const cached = await edgeCacheGet(cacheKey);
      if (cached) return cached;
      let resp = new Response(generateHomePage(env?.scu || scu), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      resp = withCacheHeaders(resp, EDGE_CACHE_TTL_HOME, EDGE_CACHE_SWR_HOME);
      ctx.waitUntil(edgeCachePut(cacheKey, resp));
      return resp;
    }

    const subMatch = path.match(/^\/([^\/]+)\/sub$/);
    if (subMatch) {
      const cacheKey = makeCacheKey(request.url);
      const cached = await edgeCacheGet(cacheKey);
      if (cached) return cached;

      const uuid = subMatch[1];
      const domain = url.searchParams.get('domain');
      if (!domain) return new Response('Missing domain', { status: 400 });

      epd = url.searchParams.get('epd') !== 'no';
      epi = url.searchParams.get('epi') !== 'no';
      egi = url.searchParams.get('egi') !== 'no';
      const piu = url.searchParams.get('piu') || defaultIPURL;
      const evEnabled = url.searchParams.get('ev') !== 'no';
      const etEnabled = url.searchParams.get('et') === 'yes';
      const vmEnabled = url.searchParams.get('mess') === 'yes';
      const customPath = url.searchParams.get('path') || '/';

      let resp = await handleSubscriptionRequest(request, uuid, domain, piu, true, true, true, true, true, evEnabled, etEnabled, vmEnabled, true, customPath, null);
      resp = withCacheHeaders(resp, EDGE_CACHE_TTL_SUB, EDGE_CACHE_SWR_SUB);
      ctx.waitUntil(edgeCachePut(cacheKey, resp));
      return resp;
    }

    return new Response('Not Found', { status: 404 });
  }
};
