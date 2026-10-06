#!/usr/bin/env python3
"""Solo release tool.

  python3 tools/deploy.py preview [FOLDER]     build the test copy of the working tree into FOLDER
  python3 tools/deploy.py test                 push branch `test` and publish it to https://solo-note-test.github.io/
  python3 tools/deploy.py live --nat-said-yes  merge `test` into `main` (the live app Tata uses) and push

The test overlay (yellow strip, "Solo TEST" name, marked icons, noindex) is applied only to the
published copy; the source in this repo stays identical to what goes live.
Needs git and Pillow (pip3 install pillow).
"""
import io, json, os, re, shutil, subprocess, sys, tempfile, zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SITE_URL = "https://github.com/solo-note-test/solo-note-test.github.io.git"
SITE_DIR = Path(os.environ.get("SOLO_SITE_DIR", Path.home() / ".solo-deploy" / "solo-note-test.github.io"))
SKIP = {".git", "tools", "testkit", "tests", ".github", "node_modules", ".gitignore"}
SITE_KEEP = {".git", "README.md", "BUILD"}   # files that belong to the test-site repo itself
YELLOW, INK = "#FFC93C", "#1E1B2E"
ZIP = "zrodla/solo-kod-zrodlowy.zip"


def git(*args, cwd=REPO, capture=True):
    r = subprocess.run(["git", *args], cwd=cwd, text=True, capture_output=capture)
    if r.returncode:
        sys.exit(f"git {' '.join(args)} failed:\n{r.stderr or ''}{r.stdout or ''}")
    return (r.stdout or "").strip()


def require_clean():
    if git("status", "--porcelain", "--untracked-files=no"):
        sys.exit("Uncommitted changes. Commit them first (the published copy must match a pushed commit).")


# ---------------- building the test copy ----------------
def copy_tree(dest, files):
    for rel in files:
        if Path(rel).parts[0] in SKIP:
            continue
        src, out = REPO / rel, dest / rel
        if src.is_file():
            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, out)


def sub_once(pattern, repl, text, what, count=0):
    new, n = re.subn(pattern, repl, text, count=count)
    if not n:
        sys.exit(f"Test overlay: could not find {what}. Update tools/deploy.py.")
    return new


def badge_png(path, maskable):
    from PIL import Image, ImageDraw
    im = Image.open(path).convert("RGBA")
    w = im.width
    big = 4                                      # draw large, scale down: smooth edges
    layer = Image.new("RGBA", (w * big, w * big), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    if maskable:   cx, r = 0.66, 0.15            # stays inside the maskable safe zone
    elif w <= 48:  cx, r = 0.70, 0.30            # favicon: big enough to see
    else:          cx, r = 0.74, 0.20
    S = w * big
    c, rr = cx * S, r * S
    d.ellipse([c - rr, c - rr, c + rr, c + rr], fill=YELLOW, outline=INK, width=max(1, round(rr * 0.08)))
    t = rr * 0.22                                # stroke of the letter T
    d.rectangle([c - rr * 0.55, c - rr * 0.55, c + rr * 0.55, c - rr * 0.55 + t], fill=INK)
    d.rectangle([c - t / 2, c - rr * 0.55, c + t / 2, c + rr * 0.6], fill=INK)
    im.alpha_composite(layer.resize((w, w), Image.LANCZOS))
    im.save(path)


def badge_svg(path):
    s = path.read_text()
    mark = (f'<circle cx="74" cy="74" r="22" fill="{YELLOW}" stroke="{INK}" stroke-width="2"/>'
            f'<rect x="62" y="62" width="24" height="5" fill="{INK}"/><rect x="71.5" y="62" width="5" height="25" fill="{INK}"/>')
    path.write_text(sub_once(r"</svg>\s*$", mark + "</svg>", s, "</svg> in favicon.svg", 1))


def apply_overlay(dest, build):
    for html in dest.rglob("*.html"):
        s = html.read_text()
        s = sub_once(r"<html([^>]*)>", rf'<html\1 data-env="test" data-build="{build}">', s, f"<html> in {html.name}", 1)
        s = sub_once(r'(<meta charset="utf-8">)', r'\1\n<meta name="robots" content="noindex, nofollow">', s, f"charset in {html.name}", 1)
        s = sub_once(r"Solo</title>", "Solo TEST</title>", s, f"<title> in {html.name}", 1)
        s = sub_once(r'(<meta name="theme-color" content=")[^"]*"', rf'\1{YELLOW}"', s, f"theme-color in {html.name}")
        s = re.sub(r'(<meta name="apple-mobile-web-app-title" content=")[^"]*"', r'\1Solo TEST"', s)
        html.write_text(s)
    # theme.js and app.js reset theme-color when the look changes: keep it yellow
    for js in ("theme.js", "app.js"):
        p = dest / js
        p.write_text(sub_once(r't === "dark" \? "#170B0F" : "#F4EEE4"', f'"{YELLOW}"', p.read_text(), f"theme colour in {js}"))
    mp = dest / "manifest.webmanifest"
    m = json.loads(mp.read_text())
    m.update(name="Solo TEST", short_name="Solo TEST", theme_color=YELLOW)
    mp.write_text(json.dumps(m, ensure_ascii=False, indent=2) + "\n")
    for png in (dest / "icons").glob("*.png"):
        badge_png(png, maskable="maskable" in png.name)
    badge_svg(dest / "icons" / "favicon.svg")
    (dest / "robots.txt").write_text("User-agent: *\nDisallow: /\n")
    (dest / ".nojekyll").write_text("")


def add_test_pages(dest):
    # pages that exist only on the test site (never live): tools/sprawdzian/*
    for f in (REPO / "tools" / "sprawdzian").glob("*"):
        if f.is_file():
            shutil.copy2(f, dest / f.name)


def cmd_preview(folder):
    dest = Path(folder or REPO.parent / "solo-preview").resolve()
    if dest == REPO or REPO in dest.parents:
        sys.exit("Choose a folder outside the repo.")
    shutil.rmtree(dest, ignore_errors=True)
    files = git("ls-files", "--cached", "--others", "--exclude-standard").splitlines()
    copy_tree(dest, files)
    apply_overlay(dest, "podgląd")
    add_test_pages(dest)
    print(f"Test copy built in {dest}\nTo look at it:  python3 -m http.server 8000 --directory \"{dest}\"  → http://localhost:8000/")


# ---------------- publishing to the test site ----------------
def site_checkout():
    if not (SITE_DIR / ".git").exists():
        SITE_DIR.parent.mkdir(parents=True, exist_ok=True)
        git("clone", "-q", SITE_URL, str(SITE_DIR), cwd=SITE_DIR.parent)
    git("fetch", "-q", "origin", cwd=SITE_DIR)
    git("checkout", "-q", "main", cwd=SITE_DIR)
    git("reset", "-q", "--hard", "origin/main", cwd=SITE_DIR)
    git("clean", "-qfdx", cwd=SITE_DIR)


def cmd_test():
    if git("rev-parse", "--abbrev-ref", "HEAD") != "test":
        sys.exit("Switch to branch `test` first:  git checkout test")
    require_clean()
    git("push", "-q", "-u", "origin", "test", capture=False)
    sha, subject = git("log", "-1", "--format=%h"), git("log", "-1", "--format=%s")

    site_checkout()
    bf = SITE_DIR / "BUILD"
    build = int(bf.read_text().strip() or 0) + 1 if bf.exists() else 1
    for p in SITE_DIR.iterdir():
        if p.name not in SITE_KEEP:
            shutil.rmtree(p) if p.is_dir() else p.unlink()
    copy_tree(SITE_DIR, git("ls-files").splitlines())
    apply_overlay(SITE_DIR, build)
    add_test_pages(SITE_DIR)
    bf.write_text(f"{build}\n")

    git("add", "-A", cwd=SITE_DIR)
    git("commit", "-q", "-m", f"Test {build}: {sha} {subject}", cwd=SITE_DIR)
    git("push", "-q", "origin", "main", cwd=SITE_DIR, capture=False)
    print(f"Published test {build} ({sha} {subject}).\nIn 1–2 minutes: https://solo-note-test.github.io/  (Ustawienia shows “· test {build}”)")


# ---------------- going live ----------------
def rebuild_zip():
    zp = REPO / ZIP
    with zipfile.ZipFile(zp) as old:   # files kept from the current zip (they don't live in the repo)
        kept = {n: old.read(n) for n in ("CZYTAJ.txt", "_headers") if n in old.namelist()}
    tracked = git("ls-files").splitlines()
    app = sorted(f for f in tracked if "/" not in f and (f.endswith((".js", ".css", ".html")) or f == "manifest.webmanifest"))
    lic = ["LICENSE.txt", "homr/LICENSE-homr-web.txt", "homr/NOTICE-homr-web.txt"]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in app + lic:
            z.write(REPO / f, f)
        for n, data in kept.items():
            z.writestr(n, data)
    zp.write_bytes(buf.getvalue())


def cmd_live(args):
    if "--nat-said-yes" not in args:
        sys.exit("Live is Tata's app. Only with Nat's explicit “tak”:  python3 tools/deploy.py live --nat-said-yes")
    require_clean()
    git("fetch", "-q", "origin")
    git("checkout", "-q", "test")
    git("merge", "-q", "--ff-only", "origin/test")
    git("checkout", "-q", "main")
    git("merge", "-q", "--ff-only", "origin/main")
    git("merge", "-q", "--no-edit", "test")
    rebuild_zip()
    if git("status", "--porcelain", "--", ZIP):
        ver = re.search(r'const VERSION = "([^"]+)"', (REPO / "app.js").read_text()).group(1)
        git("add", ZIP)
        git("commit", "-q", "-m", f"Source zip for {ver}")
    git("push", "-q", "origin", "main", capture=False)
    git("checkout", "-q", "test")
    git("merge", "-q", "--ff-only", "main")
    git("push", "-q", "origin", "test", capture=False)
    print("Live updated: https://nniewinskame-design.github.io/Solo/ (1–2 minutes). Branch `test` = `main` again.")


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or a[0] not in ("preview", "test", "live"):
        sys.exit(__doc__)
    if a[0] == "preview": cmd_preview(a[1] if len(a) > 1 else None)
    elif a[0] == "test": cmd_test()
    else: cmd_live(a[1:])
