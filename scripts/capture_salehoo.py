from playwright.sync_api import sync_playwright
import os

URL = "https://www.salehoo.com/"
OUTPUT_DIR = "/opt/claude-seo-UI/screenshots"
os.makedirs(OUTPUT_DIR, exist_ok=True)

VIEWPORTS = [
    {"name": "desktop", "width": 1920, "height": 1080},
    {"name": "laptop",  "width": 1366, "height": 768},
    {"name": "tablet",  "width": 768,  "height": 1024},
    {"name": "mobile",  "width": 375,  "height": 812},
]

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox", "--disable-setuid-sandbox"])

    for vp in VIEWPORTS:
        print(f"\n--- {vp['name'].upper()} ({vp['width']}x{vp['height']}) ---")
        ua = (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
            if vp["name"] == "mobile" else
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        context = browser.new_context(
            viewport={"width": vp["width"], "height": vp["height"]},
            user_agent=ua
        )
        page = context.new_page()
        page.goto(URL, wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(2000)

        # Above-the-fold screenshot
        atf_path = f"{OUTPUT_DIR}/salehoo_{vp['name']}_atf.png"
        page.screenshot(path=atf_path, full_page=False)
        print(f"  Saved ATF: {atf_path}")

        # Full-page screenshot
        full_path = f"{OUTPUT_DIR}/salehoo_{vp['name']}_full.png"
        page.screenshot(path=full_path, full_page=True)
        print(f"  Saved full: {full_path}")

        # Gather metrics
        metrics = page.evaluate("""(vpHeight) => {
            const h1 = document.querySelector('h1');
            const ctaSelectors = [
                'a[href*="pricing"]', 'a[href*="signup"]', 'a[href*="register"]',
                'a[href*="trial"]', 'a[href*="start"]', '.btn', '[class*="cta"]',
                '[class*="hero"] a', 'header a[class*="btn"]'
            ];
            let cta = null;
            for (const sel of ctaSelectors) {
                cta = document.querySelector(sel);
                if (cta) break;
            }
            const nav = document.querySelector('nav, header');
            const bodyWidth = document.body.scrollWidth;
            const viewWidth = window.innerWidth;
            const allLinks = Array.from(document.querySelectorAll('nav a, header a')).slice(0, 12);
            const smallTargets = allLinks.filter(a => {
                const r = a.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && (r.width < 48 || r.height < 48);
            });
            const imgsMissingDims = Array.from(document.querySelectorAll('img'))
                .filter(i => !i.getAttribute('width') && !i.getAttribute('height')).length;

            const h1Rect = h1 ? h1.getBoundingClientRect() : null;
            const ctaRect = cta ? cta.getBoundingClientRect() : null;

            return {
                h1Text: h1 ? h1.innerText.trim().substring(0, 120) : 'NOT FOUND',
                h1InViewport: h1Rect ? (h1Rect.top < vpHeight && h1Rect.bottom > 0) : false,
                h1Top: h1Rect ? Math.round(h1Rect.top) : null,
                ctaText: cta ? cta.innerText.trim().substring(0, 80) : 'NOT FOUND',
                ctaHref: cta ? cta.href : null,
                ctaInViewport: ctaRect ? (ctaRect.top < vpHeight && ctaRect.bottom > 0) : false,
                ctaTop: ctaRect ? Math.round(ctaRect.top) : null,
                navPresent: !!nav,
                hasHorizontalScroll: bodyWidth > viewWidth,
                bodyScrollWidth: bodyWidth,
                viewportWidth: viewWidth,
                baseFontSize: window.getComputedStyle(document.body).fontSize,
                smallTouchTargets: smallTargets.map(a => ({
                    text: a.innerText.trim().substring(0,30),
                    w: Math.round(a.getBoundingClientRect().width),
                    h: Math.round(a.getBoundingClientRect().height)
                })),
                imgsMissingDimensions: imgsMissingDims,
                viewportMeta: (() => {
                    const vm = document.querySelector('meta[name="viewport"]');
                    return vm ? vm.getAttribute('content') : 'MISSING';
                })(),
            };
        }""", vp["height"])

        print(f"  H1: \"{metrics['h1Text']}\"")
        print(f"  H1 in viewport: {metrics['h1InViewport']} (top={metrics['h1Top']}px)")
        print(f"  CTA: \"{metrics['ctaText']}\"")
        print(f"  CTA in viewport: {metrics['ctaInViewport']} (top={metrics['ctaTop']}px)")
        print(f"  Nav present: {metrics['navPresent']}")
        print(f"  Horizontal scroll: {metrics['hasHorizontalScroll']} (body={metrics['bodyScrollWidth']}px, vp={metrics['viewportWidth']}px)")
        print(f"  Base font size: {metrics['baseFontSize']}")
        print(f"  Viewport meta: {metrics['viewportMeta']}")
        print(f"  Small touch targets (<48px): {len(metrics['smallTouchTargets'])}")
        for t in metrics['smallTouchTargets']:
            print(f"    - \"{t['text']}\" {t['w']}x{t['h']}px")
        print(f"  Images missing dimensions: {metrics['imgsMissingDimensions']}")

        context.close()

    browser.close()
    print("\nAll screenshots captured successfully.")
