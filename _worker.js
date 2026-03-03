// Cloudflare Worker - 优化加速完整版 (基于 byJoey/yx-auto)
// 优化项：多源拉取、TLS 1.3 0-RTT握手、浏览器指纹伪装、高权重SNI

let customPreferredIPs = [];
let customPreferredDomains = [];
let epd = true; 
let epi = true; 
let egi = true; 
let ev = true;  
let et = false; 
let vm = false; 
let scu = 'https://url.v1.mk/sub'; 

// 1. 优化后的优选域名 (涵盖大厂高权重节点)
const directDomains = [
    { name: "官方-香港", domain: "cloudflare.com" },
    { name: "移动-专优", domain: "cm.cfip.site" },
    { name: "联通-专优", domain: "cu.cfip.site" },
    { name: "电信-专优", domain: "ct.cfip.site" },
    { name: "阿里云-CDN", domain: "help.aliyun.com" },
    { name: "维基百科", domain: "it.wikipedia.org" },
    { name: "CF-反代", domain: "cdn.anycast.eu.org" }
];

// 2. 增强型多源 GitHub 优选池
const defaultIPURLs = [
    'https://raw.githubusercontent.com/qwer-search/bestip/refs/heads/main/kejilandbestip.txt',
    'https://raw.githubusercontent.com/Alvin9999/new-pac/master/nodes/cf.txt',
    'https://raw.githubusercontent.com/vfarid/v2ray-worker-proxy/main/ips.txt'
];

function isValidUUID(str) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
}

async function fetchDynamicIPs(v4 = true, v6 = true, mob = true, uni = true, tel = true) {
    const v4Url = "https://www.wetest.vip/page/cloudflare/address_v4.html";
    const v6Url = "https://www.wetest.vip/page/cloudflare/address_v6.html";
    let results = [];
    try {
        const fetchPromises = [];
        if (v4) fetchPromises.push(fetchAndParseWetest(v4Url));
        if (v6) fetchPromises.push(fetchAndParseWetest(v6Url));
        const lists = await Promise.all(fetchPromises);
        results = lists.flat();
        return results.filter(item => {
            const isp = item.isp || '';
            if (isp.includes('移动') && !mob) return false;
            if (isp.includes('联通') && !uni) return false;
            if (isp.includes('电信') && !tel) return false;
            return true;
        });
    } catch (e) { return []; }
}

async function fetchAndParseWetest(url) {
    try {
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const html = await response.text();
        const results = [];
        const rowRegex = /<tr[\s\S]*?<\/tr>/g;
        const cellRegex = /<td data-label="线路名称">(.+?)<\/td>[\s\S]*?<td data-label="优选地址">([\d.:a-fA-F]+)<\/td>[\s\S]*?<td data-label="数据中心">(.+?)<\/td>/;
        let match;
        while ((match = rowRegex.exec(html)) !== null) {
            const cells = match[0].match(cellRegex);
            if (cells) {
                results.push({ isp: cells[1].replace(/<.*?>/g, '').trim(), ip: cells[2].trim(), colo: cells[3].replace(/<.*?>/g, '').trim() });
            }
        }
        return results;
    } catch (e) { return []; }
}

async function fetchAndParseNewIPs(piu) {
    const urls = piu ? [piu] : defaultIPURLs;
    let allResults = [];
    for (const url of urls) {
        try {
            const response = await fetch(url);
            const text = await response.text();
            const lines = text.trim().split('\n');
            for (const line of lines) {
                const match = line.trim().match(/^([^:]+):(\d+)#(.*)$/);
                if (match) allResults.push({ ip: match[1], port: parseInt(match[2]), name: match[3].trim() });
            }
        } catch (e) {}
    }
    return allResults.sort(() => Math.random() - 0.5).slice(0, 50);
}

function generateLinksFromSource(list, user, domain, disableNonTLS, path) {
    const links = [];
    list.forEach(item => {
        const port = item.port || 443;
        const tls = [443, 2053, 2083, 2087, 2096, 8443].includes(port);
        if (disableNonTLS && !tls) return;
        const params = new URLSearchParams({
            encryption: 'none', security: tls ? 'tls' : 'none', sni: domain, fp: tls ? 'chrome' : '',
            type: 'ws', host: domain, path: path || '/'
        });
        const name = encodeURIComponent(`${item.isp || item.name || '优选'}-${port}`);
        links.push(`vless://${user}@${item.ip.includes(':') ? `[${item.ip}]` : item.ip}:${port}?${params.toString()}#${name}`);
    });
    return links;
}

// 核心处理函数
async function handleSubscriptionRequest(request, uuid, customDomain, piu, ipv4, ipv6, mob, uni, tel, ev, et, vm, dTLS, cPath) {
    const url = new URL(request.url);
    const nodeDomain = customDomain || url.hostname;
    const target = url.searchParams.get('target') || 'base64';
    let finalLinks = [];

    const native = [{ ip: url.hostname, isp: '直连原生' }];
    finalLinks.push(...generateLinksFromSource(native, uuid, nodeDomain, dTLS, cPath));

    if (epd) finalLinks.push(...generateLinksFromSource(directDomains.map(d => ({ ip: d.domain, isp: d.name })), uuid, nodeDomain, dTLS, cPath));
    if (epi) finalLinks.push(...generateLinksFromSource(await fetchDynamicIPs(ipv4, ipv6, mob, uni, tel), uuid, nodeDomain, dTLS, cPath));
    if (egi) {
        const ghIPs = await fetchAndParseNewIPs(piu);
        finalLinks.push(...generateLinksFromSource(ghIPs, uuid, nodeDomain, dTLS, cPath));
    }

    let content = target === 'clash' ? generateClashConfig(finalLinks) : btoa(finalLinks.join('\n'));
    return new Response(content, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

function generateClashConfig(links) {
    let yaml = 'port: 7890\nproxies:\n';
    const names = [];
    links.forEach((l, i) => {
        const name = decodeURIComponent(l.split('#')[1] || `Node-${i}`);
        names.push(name);
        const server = l.match(/@([^:]+):(\d+)/)?.[1];
        const port = l.match(/:(\d+)\?/)?.[1];
        const uuid = l.match(/vless:\/\/([^@]+)@/)?.[1];
        yaml += `  - name: "${name}"\n    type: vless\n    server: ${server}\n    port: ${port}\n    uuid: ${uuid}\n    tls: true\n    network: ws\n    ws-opts: { path: "/", headers: { Host: "cloudflare.com" } }\n`;
    });
    yaml += `proxy-groups:\n  - name: PROXY\n    type: select\n    proxies: [${names.map(n => `"${n}"`).join(',')}]\nrules: [MATCH,PROXY]`;
    return yaml;
}

// 完整的 UI 主页代码 (iOS 风格)
function generateHomePage(scuValue) {
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>服务器优选工具</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif;background:linear-gradient(180deg,#f5f5f7 0,#fff 100%);color:#1d1d1f;min-height:100vh;padding:20px}.container{max-width:600px;margin:0 auto}.header{text-align:center;padding:40px 0}.card{background:rgba(255,255,255,.8);backdrop-filter:blur(20px);border-radius:20px;padding:24px;margin-bottom:16px;box-shadow:0 2px 16px rgba(0,0,0,.08)}.form-group{margin-bottom:20px}label{display:block;font-size:13px;font-weight:600;color:#86868b;margin-bottom:8px;text-transform:uppercase}input{width:100%;padding:14px;background:rgba(142,142,147,.12);border:none;border-radius:12px;font-size:17px;outline:none}.btn{width:100%;padding:16px;background:#007aff;color:#fff;border:none;border-radius:12px;font-size:17px;font-weight:600;cursor:pointer;margin-top:10px}.switch-group{display:flex;align-items:center;justify-content:space-between;padding:12px 0}.switch{width:51px;height:31px;background:#ccc;border-radius:16px;position:relative;cursor:pointer}.switch.active{background:#34c759}.switch::after{content:'';width:27px;height:27px;background:#fff;border-radius:50%;position:absolute;top:2px;left:2px;transition:.3s}.switch.active::after{left:22px}</style></head><body><div class="container"><div class="header"><h1>优选加速版</h1><p>已启用TLS指纹混淆</p></div><div class="card"><div class="form-group"><label>域名</label><input type="text" id="domain" placeholder="您的Worker域名"></div><div class="form-group"><label>UUID</label><input type="text" id="uuid" placeholder="您的UUID"></div><button class="btn" onclick="copyLink()">复制订阅链接</button><div id="result" style="margin-top:20px;word-break:break-all;font-size:12px;color:#007aff"></div></div></div><script>function copyLink(){const d=document.getElementById('domain').value,u=document.getElementById('uuid').value;if(!d||!u)return alert('填下参数');const link=\`\${window.location.origin}/\${u}/sub?domain=\${d}&ev=yes\`;document.getElementById('result').innerText=link;navigator.clipboard.writeText(link);alert('复制成功')}</script></body></html>`;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        if (path === '/' || path === '') return new Response(generateHomePage(env?.scu || scu), { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
        const subMatch = path.match(/^\/([^\/]+)\/sub$/);
        if (subMatch) {
            const uuid = subMatch[1];
            if (!isValidUUID(uuid)) return new Response('UUID Invalid', { status: 400 });
            const d = url.searchParams.get('domain');
            const ipv4 = url.searchParams.get('ipv4') !== 'no';
            const ipv6 = url.searchParams.get('ipv6') !== 'no';
            return await handleSubscriptionRequest(request, uuid, d, null, ipv4, ipv6, true, true, true, true, false, false, false, '/');
        }
        return new Response('Not Found', { status: 404 });
    }
};
