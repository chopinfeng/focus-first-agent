#!/usr/bin/env python3
"""Build the GitHub Pages site under docs/: home, article, design reference, rendered docs, prototype, demo, playground, run reports.
Re-run after editing any source. Sources: docs/ARTICLE.md, docs/*.md, docs/focus-first-agent.html, docs/ui-prototype.html, docs/demo.html, ffa/playground.html, demo/runs/*.md"""
import re, html, pathlib, shutil, datetime
ROOT = pathlib.Path(__file__).resolve().parent.parent
D = ROOT / "docs"
SITE = "https://chopinfeng.github.io/focus-first-agent/"
NAV_ITEMS = [("index.html","首页"),("article.html","文章"),("design.html","设计参考"),("docs.html","文档"),("inbox.html","收件箱原型"),("demo.html","动态演示"),("playground.html","Playground"),("runs.html","运行报告"),("https://github.com/chopinfeng/focus-first-agent","GitHub")]

def nav(current):
    links = "".join(f'<a href="{h}"{" class=on" if h==current else ""}{" target=_blank rel=noopener" if h.startswith("http") else ""}>{t}</a>' for h,t in NAV_ITEMS)
    return f'''<nav class="site-nav" aria-label="站点"><a class="site-brand" href="index.html"><i></i>Focus-First Agent</a><div class="site-links">{links}</div></nav>
<style>.site-nav{{display:flex;align-items:center;gap:18px;padding:0 20px;height:42px;background:var(--surface,#fff);border-bottom:1px solid var(--line,#d7ddda);font:13px/1 "IBM Plex Sans","PingFang SC","Hiragino Sans GB","Noto Sans CJK SC",sans-serif;position:relative;z-index:50}}
.site-brand{{display:inline-flex;align-items:center;gap:8px;font-family:"Manrope","PingFang SC",sans-serif;font-weight:800;font-size:13px;color:var(--ink,#1b2421);text-decoration:none;border:0;white-space:nowrap}}
.site-brand i{{width:8px;height:8px;border-radius:50%;background:var(--amber,var(--needs,#c4700f));display:inline-block}}
.site-links{{display:flex;gap:2px;margin-left:auto;overflow-x:auto}}
.site-links a{{padding:6px 9px;border-radius:4px;color:var(--muted,#62706b);text-decoration:none;border:0;white-space:nowrap}}
.site-links a:hover{{color:var(--ink,#1b2421)}}.site-links a.on{{background:var(--sunken,#eaeeec);color:var(--ink,#1b2421);font-weight:500}}
@media (max-width:640px){{.site-nav{{height:auto;flex-wrap:wrap;padding:8px 12px;gap:8px}}.site-links{{margin-left:0}}}}</style>
'''

def wrap_flat(src_text, current, title=None):
    """Artifact-format page (flat: title/link/style/markup/script) -> standalone document with nav."""
    t = title or re.search(r"<title>(.*?)</title>", src_text).group(1)
    head = f'<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>{t}</title>\n</head>\n<body>\n'
    body = src_text.replace('<meta charset="utf-8">\n', '')
    return head + nav(current) + body + "\n</body>\n</html>\n"

# ---------- minimal markdown ----------
def slug(t):
    return re.sub(r"[^\w\u4e00-\u9fff]+", "-", t)[:60]

def inline(s):
    s = html.escape(s, quote=False)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<!\*)\*(?!\*)(.+?)\*(?!\*)", r"<em>\1</em>", s)
    s = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", r'<img src="\2" alt="\1" loading="lazy">', s)
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', s)
    s = re.sub(r"(?<![\"'>=])(https?://[^\s<)]+)", r'<a href="\1">\1</a>', s)
    return s
def md(text):
    out, lines, i = [], text.split("\n"), 0
    while i < len(lines):
        l = lines[i]
        if l.startswith("```"):
            j = i + 1; buf = []
            while j < len(lines) and not lines[j].startswith("```"): buf.append(lines[j]); j += 1
            out.append("<pre><code>" + html.escape("\n".join(buf)) + "</code></pre>"); i = j + 1; continue
        if re.match(r"^\s*\|", l):
            rows = []
            while i < len(lines) and re.match(r"^\s*\|", lines[i]): rows.append(lines[i]); i += 1
            rows = [r for r in rows if not re.match(r"^\s*\|[\s:\-|]+\|\s*$", r)]
            cells = [[c.strip() for c in r.strip().strip("|").split("|")] for r in rows]
            if cells:
                out.append("<div class=tbl><table><tr>" + "".join(f"<th>{inline(c)}</th>" for c in cells[0]) + "</tr>" + "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in cells[1:]) + "</table></div>")
            continue
        m = re.match(r"^(#{1,6})\s+(.*)", l)
        if m:
            n = len(m.group(1)); sid = slug(m.group(2)); out.append(f'<h{n} id="{sid}">{inline(m.group(2))}</h{n}>'); i += 1; continue
        if re.match(r"^\s*[-*]\s+", l) or re.match(r"^\s*\d+\.\s+", l):
            ordered = bool(re.match(r"^\s*\d+\.\s+", l)); items = []
            while i < len(lines) and (re.match(r"^\s*[-*]\s+", lines[i]) or re.match(r"^\s*\d+\.\s+", lines[i])):
                items.append(re.sub(r"^\s*([-*]|\d+\.)\s+", "", lines[i])); i += 1
            tag = "ol" if ordered else "ul"; out.append(f"<{tag}>" + "".join(f"<li>{inline(x)}</li>" for x in items) + f"</{tag}>"); continue
        if l.startswith(">"):
            buf = []
            while i < len(lines) and lines[i].startswith(">"): buf.append(lines[i].lstrip("> ")); i += 1
            out.append("<blockquote>" + inline(" ".join(buf)) + "</blockquote>"); continue
        if re.match(r"^\s*(-{3,}|\*{3,})\s*$", l): out.append("<hr>"); i += 1; continue
        if not l.strip(): i += 1; continue
        buf = []
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#|\s*[-*]\s|\s*\d+\.\s|>|```|\s*\||\s*-{3,})", lines[i]): buf.append(lines[i]); i += 1
        out.append("<p>" + inline(" ".join(buf)) + "</p>")
    return "\n".join(out)

DOC_CSS = '''<style>
:root{--ground:#F5F6F4;--surface:#FFFFFF;--sunken:#EAEEEC;--ink:#1B2421;--muted:#62706B;--line:#D7DDDA;--amber:#C4700F;--amber-soft:#F6E5CF;--done:#2F7A4E}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--ground:#101715;--surface:#182120;--sunken:#141C1A;--ink:#E4EBE8;--muted:#93A39E;--line:#2A3634;--amber:#E39A3F;--amber-soft:#3A2A14;--done:#6CC08B}}
*{box-sizing:border-box}body{margin:0;background:var(--ground);color:var(--ink);font:15.5px/1.8 "IBM Plex Sans","PingFang SC","Hiragino Sans GB","Noto Sans CJK SC",sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--amber);text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--amber) 40%,transparent)}
.wrap{max-width:1100px;margin:0 auto;padding:28px 20px 80px;display:grid;grid-template-columns:220px minmax(0,1fr);gap:40px;align-items:start}
.side{position:sticky;top:20px;font-size:13px;line-height:1.5}.side .eyebrow{font:700 11px/1 "Manrope",sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
.side ol{list-style:none;margin:0;padding:0;border-left:1px solid var(--line)}.side a{display:block;padding:5px 0 5px 14px;color:var(--muted);border:0;margin-left:-1px;border-left:2px solid transparent}.side a.on{color:var(--ink);border-left-color:var(--amber)}
main{max-width:78ch;min-width:0}
h1{font:800 32px/1.2 "Manrope","PingFang SC",sans-serif;letter-spacing:-.01em;margin:0 0 6px;text-wrap:balance}h2{font:700 22px/1.3 "Manrope","PingFang SC",sans-serif;margin:48px 0 12px;padding-top:20px;border-top:1px solid var(--line)}h3{font:700 17px/1.35 "Manrope","PingFang SC",sans-serif;margin:28px 0 8px}h4{font:600 15px/1.4 "Manrope","PingFang SC",sans-serif;margin:18px 0 6px}
p{margin:10px 0}blockquote{margin:16px 0;padding:10px 16px;border-left:3px solid var(--amber);background:var(--amber-soft);color:var(--ink)}
code{font:.88em "IBM Plex Mono",Menlo,monospace;background:var(--sunken);padding:1px 5px;border-radius:3px}pre{font:12.5px/1.6 "IBM Plex Mono",Menlo,monospace;background:var(--sunken);border:1px solid var(--line);border-radius:4px;padding:14px 16px;overflow:auto}pre code{background:none;padding:0}
.tbl{overflow-x:auto;margin:12px 0}table{border-collapse:collapse;width:100%;font-size:13.5px;line-height:1.5}th{font:500 12px/1.4 "IBM Plex Mono",monospace;color:var(--muted);text-align:left;padding:8px 10px 8px 0;border-bottom:2px solid var(--line)}td{padding:8px 10px 8px 0;border-bottom:1px solid var(--line);vertical-align:top}
img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:6px;display:block;margin:14px 0}hr{border:0;border-top:1px solid var(--line);margin:36px 0}
.meta{font:12px/1.5 "IBM Plex Mono",monospace;color:var(--muted);margin-bottom:22px}
@media (max-width:860px){.wrap{grid-template-columns:1fr;gap:16px}.side{position:static}.side ol{display:flex;flex-wrap:wrap;border:0;gap:4px 12px}.side a{padding:3px 0;border:0}}
</style>'''

def doc_page(title, body_html, current, side_html="", meta=""):
    return f'''<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@700;800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
{DOC_CSS}
</head>
<body>
{nav(current)}
<div class="wrap"><aside class="side">{side_html}</aside><main>{f'<div class="meta">{meta}</div>' if meta else ''}{body_html}</main></div>
<script>(function(){{var as=[...document.querySelectorAll('.side a[href^="#"]')];var hs=as.map(function(a){{return document.getElementById(a.getAttribute('href').slice(1))}});if(!('IntersectionObserver' in window))return;var io=new IntersectionObserver(function(es){{es.forEach(function(e){{if(e.isIntersecting){{var i=hs.indexOf(e.target);as.forEach(function(a,j){{a.classList.toggle('on',j===i)}})}}}})}},{{rootMargin:'-20% 0px -70% 0px'}});hs.forEach(function(h){{h&&io.observe(h)}})}})();</script>
</body>
</html>
'''

def toc_from_md(text, depth=2):
    items = []
    for l in text.split("\n"):
        m = re.match(r"^(#{1,%d})\s+(.*)" % depth, l)
        if m and len(m.group(1)) > 1:
            t = re.sub(r"[*`]", "", m.group(2)); sid = slug(m.group(2)); items.append(f'<li><a href="#{sid}">{html.escape(t[:28])}</a></li>')
    return "<ol>" + "".join(items) + "</ol>"

# ---------- 1. article ----------
art_src = (D / "article.src.html") if (D / "article.src.html").exists() else (D / "index.html")
art = art_src.read_text(encoding="utf-8")
if "site-nav" not in art:
    art = art.replace("<body>\n", "<body>\n" + nav("article.html"), 1)
    # footer links -> site pages first
    art = art.replace('<a href="https://claude.ai/code/artifact/3618782c-3b93-4014-b88f-22361b492531">设计参考页<small>调研、设计、界面规范、benchmark、实验</small></a>','<a href="design.html">设计参考页<small>调研、设计、界面规范、benchmark、实验</small></a>')
    art = art.replace('<a href="https://claude.ai/code/artifact/e388218d-e893-48f4-bf95-9824704f05f2">FFA Inbox 原型<small>14 种结构化介入控件</small></a>','<a href="inbox.html">FFA Inbox 原型<small>14 种结构化介入控件</small></a>')
    art = art.replace('<a href="https://claude.ai/code/artifact/3b2a08cc-af50-4794-994a-82feb8b1782b">动态演示<small>三方对照与阶段回看，可接真实 LLM</small></a>','<a href="demo.html">动态演示<small>三方对照与阶段回看，可接真实 LLM</small></a>')
    art = art.replace('<a href="https://claude.ai/code/artifact/0d34892a-7595-4acd-a0b0-701342fd278b">Kernel Playground<small>浏览器里运行的真实内核</small></a>','<a href="playground.html">Kernel Playground<small>浏览器里运行的真实内核</small></a>')
(D / "article.src.html").write_text(art, encoding="utf-8")
(D / "article.html").write_text(art, encoding="utf-8")

# ---------- 2. design reference (flat artifact page) ----------
(D / "design.html").write_text(wrap_flat((D / "focus-first-agent.html").read_text(encoding="utf-8"), "design.html"), encoding="utf-8")
# ---------- 3. prototype / demo / playground ----------
(D / "inbox.html").write_text(wrap_flat((D / "ui-prototype.html").read_text(encoding="utf-8"), "inbox.html"), encoding="utf-8")
demo_src = (D / "demo.src.html") if (D / "demo.src.html").exists() else (D / "demo.html")
demo_txt = demo_src.read_text(encoding="utf-8")
if "<!doctype" in demo_txt.lower(): demo_txt = re.search(r"<body>\n(?:<nav class=\"site-nav\".*?</style>\n)?(.*)</body>", demo_txt, re.S).group(1)
(D / "demo.src.html").write_text(demo_txt, encoding="utf-8")
(D / "demo.html").write_text(wrap_flat(demo_txt, "demo.html"), encoding="utf-8")
(D / "playground.html").write_text(wrap_flat((ROOT / "ffa" / "playground.html").read_text(encoding="utf-8"), "playground.html"), encoding="utf-8")

# ---------- 4. docs (markdown) ----------
DOCS = [("DESIGN.md","设计 v0.2"),("RESEARCH.md","调研综合"),("CHANGELOG-v0.2.md","v0.1 → v0.2 决策"),("USE-CASES.md","Use case"),("UI-UX.md","界面规范"),("TESTING.md","测试方案"),("BENCHMARK.md","AttentionBench"),("EXPERIMENTS.md","实验设计")]
RESEARCH = sorted((D / "research").glob("*.md"))
def doc_side(current_slug):
    items = "".join(f'<li><a href="doc-{n[:-3]}.html"{" class=on" if n[:-3]==current_slug else ""}>{t}</a></li>' for n,t in DOCS)
    r = "".join(f'<li><a href="doc-{p.stem}.html"{" class=on" if p.stem==current_slug else ""}>{html.escape(p.stem[3:].replace("-"," "))}</a></li>' for p in RESEARCH)
    return f'<div class="eyebrow">文档</div><ol>{items}</ol><div class="eyebrow" style="margin-top:18px">原始调研</div><ol>{r}</ol>'
for n, t in DOCS:
    text = (D / n).read_text(encoding="utf-8")
    (D / f"doc-{n[:-3]}.html").write_text(doc_page(t + " · Focus-First Agent", md(text), "docs.html", doc_side(n[:-3]), f"源文件 docs/{n}"), encoding="utf-8")
for p in RESEARCH:
    text = p.read_text(encoding="utf-8")
    (D / f"doc-{p.stem}.html").write_text(doc_page(p.stem + " · Focus-First Agent", md(text), "docs.html", doc_side(p.stem), f"源文件 docs/research/{p.name}"), encoding="utf-8")
index_docs = "<h1>文档</h1><p>设计与验证的全部文档，由仓库 Markdown 渲染。</p><div class=tbl><table><tr><th>文档</th><th>内容</th></tr>" + "".join(f'<tr><td><a href="doc-{n[:-3]}.html">{t}</a></td><td>{ {"DESIGN.md":"六个核心抽象、三级告警、调度器、信任账本、指标、路线图","RESEARCH.md":"两轮八路调研的综合结论","CHANGELOG-v0.2.md":"第二轮调研逐条对照 v0.1 的采纳、部分、拒绝、延后","USE-CASES.md":"20 个 use case，每个带可验收的注意力行为","UI-UX.md":"以保护注意力为唯一目标的十条原则与 14 种结构化控件","TESTING.md":"四层测试与 17 条不变量","BENCHMARK.md":"Attention per Task、价值层、bypass 基线与阶段回看","EXPERIMENTS.md":"15 个实验"}[n] }</td></tr>' for n,t in DOCS) + "</table></div><h2>原始调研</h2><ul>" + "".join(f'<li><a href="doc-{p.stem}.html">{html.escape(p.stem)}</a></li>' for p in RESEARCH) + "</ul>"
(D / "docs.html").write_text(doc_page("文档 · Focus-First Agent", index_docs, "docs.html", doc_side("")), encoding="utf-8")

# ---------- 5. runs ----------
runs = sorted((ROOT / "demo" / "runs").glob("*.md"), reverse=True)
body = "<h1>运行报告</h1><p>真实 LLM（BigModel glm-5）驱动的 demo 运行记录，由 <code>demo/runs/*.md</code> 渲染。</p>"
side = '<div class="eyebrow">报告</div><ol>' + "".join(f'<li><a href="#{r.stem}">{html.escape(r.stem)}</a></li>' for r in runs) + "</ol>"
for r in runs:
    body += f'<hr><div id="{r.stem}"></div>' + md(r.read_text(encoding="utf-8"))
(D / "runs.html").write_text(doc_page("运行报告 · Focus-First Agent", body, "runs.html", side), encoding="utf-8")

# ---------- 6. home ----------
home = f'''<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Focus-First Agent</title>
<meta name="description" content="把注意力当作 Agent 系统里最稀缺的资源来调度：设计、证据、原型、演示、内核与基准。">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@700;800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{{--ground:#F5F6F4;--surface:#FFFFFF;--sunken:#EAEEEC;--ink:#1B2421;--muted:#62706B;--line:#D7DDDA;--amber:#C4700F;--amber-soft:#F6E5CF;--dark:#101715;--dark-ink:#E4EBE8;--dark-muted:#8FA09A}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{--ground:#101715;--surface:#182120;--sunken:#141C1A;--ink:#E4EBE8;--muted:#93A39E;--line:#2A3634;--amber:#E39A3F;--amber-soft:#3A2A14;--dark:#0A0F0E}}}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--ground);color:var(--ink);font:16px/1.75 "IBM Plex Sans","PingFang SC","Hiragino Sans GB","Noto Sans CJK SC",sans-serif;-webkit-font-smoothing:antialiased}}
a{{color:var(--amber);text-decoration:none}}
.hero{{background:var(--dark);color:var(--dark-ink);padding:64px 24px 56px}}.hero .in{{max-width:1100px;margin:0 auto}}
.kicker{{font:12px/1 "IBM Plex Mono",monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--dark-muted);display:flex;align-items:center;gap:12px}}.kicker i{{width:9px;height:9px;border-radius:50%;background:var(--amber);display:inline-block}}
.hero h1{{font:800 clamp(30px,5vw,50px)/1.15 "Manrope","PingFang SC",sans-serif;letter-spacing:-.015em;margin:18px 0 12px;text-wrap:balance;max-width:20em}}
.hero p{{font-size:18px;color:var(--dark-muted);max-width:40em;margin:0 0 22px;text-wrap:balance}}
.hero .cta{{display:inline-flex;gap:10px;flex-wrap:wrap}}.hero .cta a{{padding:9px 16px;border-radius:5px;border:1px solid rgba(228,235,232,.25);color:var(--dark-ink);font-size:14px}}.hero .cta a.p{{background:var(--amber);border-color:var(--amber);color:#111;font-weight:600}}
.wrap{{max-width:1100px;margin:0 auto;padding:40px 24px 80px}}
h2{{font:700 13px/1 "Manrope",sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:36px 0 14px}}
.cards{{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}}
.card{{display:block;background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:16px 18px;color:var(--ink)}}.card:hover{{border-color:var(--ink)}}
.card b{{font:700 16px/1.3 "Manrope","PingFang SC",sans-serif;display:block;margin-bottom:6px}}.card span{{font-size:13.5px;color:var(--muted);line-height:1.5;display:block}}.card small{{font:11px/1 "IBM Plex Mono",monospace;color:var(--amber);display:block;margin-top:10px;letter-spacing:.04em}}
.shots{{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}}.shots a{{display:block;border:1px solid var(--line);border-radius:6px;overflow:hidden;background:var(--surface);color:var(--muted);font-size:12.5px}}.shots img{{width:100%;height:auto;display:block;border-bottom:1px solid var(--line)}}.shots span{{display:block;padding:8px 12px}}
.stats{{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}}.stat{{border-top:2px solid var(--amber);padding-top:10px}}.stat .n{{font:800 28px/1.05 "Manrope",sans-serif;font-variant-numeric:tabular-nums}}.stat .l{{font-size:12.5px;color:var(--muted);margin-top:4px;line-height:1.4}}
.foot{{font-size:13px;color:var(--muted);margin-top:40px;padding-top:16px;border-top:1px solid var(--line)}}
</style>
</head>
<body>
{nav("index.html")}
<header class="hero"><div class="in">
<div class="kicker"><i></i>Focus-First Agent · 2026 年 9 月</div>
<h1>把注意力当作 Agent 系统里最稀缺的资源来调度</h1>
<p>Agent 的断点不是人的断点。这个项目把两者对齐：一份设计，它背后的四十年证据，一个可运行的内核，以及真实 LLM Agent 跑起来之后的数据。</p>
<div class="cta"><a class="p" href="article.html">读文章</a><a href="demo.html">看动态演示</a><a href="playground.html">玩 Kernel Playground</a><a href="https://github.com/chopinfeng/focus-first-agent" target="_blank" rel="noopener">GitHub</a></div>
</div></header>
<div class="wrap">
<h2>同一套任务，三种交互</h2>
<div class="stats">
<div class="stat"><div class="n">254</div><div class="l">逐条弹窗的注意力成本（分钟）</div></div>
<div class="stat"><div class="n">135</div><div class="l">bypass 零打断，但事后要读 75 分钟 transcript，且 1 条对外消息未经确认已发出</div></div>
<div class="stat"><div class="n">22</div><div class="l">FFA：9 次打断，8 分钟事后阅读，0 条未经确认的不可逆动作</div></div>
<div class="stat"><div class="n">13 / 13</div><div class="l">内核不变量测试通过</div></div>
</div>
<h2>读</h2>
<div class="cards">
<a class="card" href="article.html"><b>Agent 的断点不是人的断点</b><span>七节长文：问题、证据、设计、界面、真实运行、度量、未完成。</span><small>约 12 分钟</small></a>
<a class="card" href="design.html"><b>设计参考</b><span>两轮调研、六个核心抽象、三级告警、调度器、信任账本、界面规范、AttentionBench、15 个实验，一页参考。</span><small>reference</small></a>
<a class="card" href="docs.html"><b>文档</b><span>设计、调研、use case、测试、benchmark、实验设计与八路原始调研，全部由仓库 Markdown 渲染。</span><small>docs/</small></a>
<a class="card" href="runs.html"><b>运行报告</b><span>BigModel glm-5 驱动的六任务并行运行，以及 bypass 与 FFA 的三方对照。</span><small>demo/runs/</small></a>
</div>
<h2>用</h2>
<div class="cards">
<a class="card" href="inbox.html"><b>FFA Inbox 原型</b><span>暗舱状态、单键作答、专注抑制与召回、已替你决定队列，以及 Coding Agent 需要人介入的 14 种结构化控件。</span><small>按 g s 打开场景库</small></a>
<a class="card" href="demo.html"><b>动态演示</b><span>75 分钟压缩时段里三个 Agent 的事件如何被合并、延迟到断点、超时默认、洪水折叠与 Warning 穿透；弹窗、bypass、FFA 三方对照。</span><small>本地起服务可接真实 LLM</small></a>
<a class="card" href="playground.html"><b>Kernel Playground</b><span>仓库里那份 kernel.mjs 原样在浏览器里运行。点按钮产生事件，看内核怎么路由。</span><small>@focus-first/ffa</small></a>
<a class="card" href="https://github.com/chopinfeng/focus-first-agent/tree/main/demo" target="_blank" rel="noopener"><b>本地实时服务</b><span>npm start 后真实 Agent 在沙箱里做任务，每个工具调用经内核路由；支持 Anthropic、OpenAI 兼容接口与 mock。</span><small>demo/README.md</small></a>
</div>
<h2>截图</h2>
<div class="shots">
<a href="screenshots/01-live-inbox.png"><img src="screenshots/01-live-inbox@1x.png" alt="实时运行中的收件箱" loading="lazy"><span>实时运行中的收件箱：事件流的路由结果、只有需要人的请求、三方对照与手机推送</span></a>
<a href="screenshots/02-live-review-panel.png"><img src="screenshots/02-live-review-panel@1x.png" alt="阶段回看" loading="lazy"><span>阶段回看：同一段执行，四种呈现物各要读多少、能发现多少</span></a>
<a href="screenshots/05-prototype-gallery.png"><img src="screenshots/05-prototype-gallery@1x.png" alt="14 种结构化控件" loading="lazy"><span>场景库：14 种结构化介入控件</span></a>
<a href="screenshots/06-playground.png"><img src="screenshots/06-playground@1x.png" alt="Kernel Playground" loading="lazy"><span>Kernel Playground：内核在浏览器里运行</span></a>
</div>
<div class="foot">仓库 <a href="https://github.com/chopinfeng/focus-first-agent">github.com/chopinfeng/focus-first-agent</a> · 站点由 <code>scripts/build-site.py</code> 生成 · {datetime.date.today().isoformat()}</div>
</div>
</body>
</html>
'''
(D / "index.html").write_text(home, encoding="utf-8")
print("site built:", sorted(p.name for p in D.glob("*.html")))
