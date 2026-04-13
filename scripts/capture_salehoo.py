from playwright.sync_api import sync_playwright
import json

URL = "https://www.salehoo.com/learn/marketing"

def capture(url, output_path, viewport_width=1920, viewport_height=1080):
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox", "--disable-setuid-sandbox"])
        page = browser.new_page(viewport={'width': viewport_width, 'height': viewport_height})
        page.goto(url, wait_until='networkidle', timeout=60000)
        page.wait_for_timeout(2000)
        page.screenshot(path=output_path, full_page=False)
        browser.close()

def extract_metadata(url):
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox", "--disable-setuid-sandbox"])
        page = browser.new_page(viewport={'width': 1920, 'height': 1080})
        page.goto(url, wait_until='networkidle', timeout=60000)
        page.wait_for_timeout(2000)

        # OG / social meta tags
        og_tags = page.evaluate("""() => {
            const metas = document.querySelectorAll('meta');
            const result = {};
            metas.forEach(m => {
                const prop = m.getAttribute('property') || m.getAttribute('name');
                if (prop) result[prop] = m.getAttribute('content');
            });
            return result;
        }""")

        # Viewport meta
        viewport_meta = page.evaluate("""() => {
            const vm = document.querySelector('meta[name="viewport"]');
            return vm ? vm.getAttribute('content') : null;
        }""")

        # H1 tags
        h1_tags = page.evaluate("""() => {
            return Array.from(document.querySelectorAll('h1')).map(h => ({
                text: h.innerText.trim(),
                rect: h.getBoundingClientRect()
            }));
        }""")

        # Title and description
        title = page.title()
        canonical = page.evaluate("() => { const c = document.querySelector('link[rel=canonical]'); return c ? c.href : null; }")

        # Check for popups/interstitials (common patterns)
        interstitials = page.evaluate("""() => {
            const selectors = [
                '[class*="popup"]', '[class*="modal"]', '[class*="overlay"]',
                '[class*="interstitial"]', '[id*="popup"]', '[id*="modal"]',
                '[class*="lightbox"]', '[class*="dialog"]', '[role="dialog"]'
            ];
            return selectors.map(sel => {
                const els = document.querySelectorAll(sel);
                return {
                    selector: sel,
                    count: els.length,
                    visible: Array.from(els).filter(el => {
                        const s = window.getComputedStyle(el);
                        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
                    }).length
                };
            }).filter(r => r.count > 0);
        }""")

        # Above-the-fold checks (viewport height = 1080)
        atf = page.evaluate("""() => {
            const vh = window.innerHeight;
            const vw = window.innerWidth;
            const h1s = Array.from(document.querySelectorAll('h1'));
            const nav = document.querySelector('nav, header, [role=navigation]');
            const ctas = Array.from(document.querySelectorAll('a[class*="btn"], a[class*="cta"], button[class*="cta"], .btn-primary, [class*="button"]'));

            return {
                viewport_height: vh,
                viewport_width: vw,
                h1_above_fold: h1s.map(h => {
                    const r = h.getBoundingClientRect();
                    return { text: h.innerText.trim().substring(0,80), top: r.top, bottom: r.bottom, above_fold: r.top < vh };
                }),
                nav_visible: nav ? nav.getBoundingClientRect().top < vh : false,
                ctas_above_fold: ctas.slice(0,5).map(c => {
                    const r = c.getBoundingClientRect();
                    return { text: c.innerText.trim().substring(0,40), top: r.top, above_fold: r.top < vh };
                })
            };
        }""")

        # CLS risk signals: images without dimensions, ads, banners
        cls_risks = page.evaluate("""() => {
            const imgs = Array.from(document.querySelectorAll('img'));
            const noDims = imgs.filter(img => !img.getAttribute('width') && !img.getAttribute('height')).length;
            const lazyImgs = imgs.filter(img => img.getAttribute('loading') === 'lazy').length;
            const adSlots = document.querySelectorAll('[class*="ad-"], [id*="ad-"], [class*="banner"], iframe').length;
            const fontsLink = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).filter(l => l.href.includes('font')).length;
            return {
                total_images: imgs.length,
                images_without_dimensions: noDims,
                lazy_loaded_images: lazyImgs,
                ad_or_banner_elements: adSlots,
                external_font_links: fontsLink
            };
        }""")

        # Mobile tap target sizes (run on mobile viewport would be ideal, but collect data)
        nav_links = page.evaluate("""() => {
            const links = Array.from(document.querySelectorAll('nav a, header a'));
            return links.slice(0, 10).map(a => {
                const r = a.getBoundingClientRect();
                return { text: a.innerText.trim().substring(0,30), width: Math.round(r.width), height: Math.round(r.height) };
            });
        }""")

        results = {
            'title': title,
            'canonical': canonical,
            'viewport_meta': viewport_meta,
            'og_tags': og_tags,
            'h1_tags': h1_tags,
            'interstitials': interstitials,
            'above_the_fold': atf,
            'cls_risks': cls_risks,
            'nav_links': nav_links
        }

        browser.close()
        return results

if __name__ == "__main__":
    print("Capturing desktop screenshot (1920x1080)...")
    capture(URL, "/opt/claude-seo-UI/screenshots/salehoo_desktop.png", 1920, 1080)
    print("Done: salehoo_desktop.png")

    print("Capturing mobile screenshot (375x812)...")
    capture(URL, "/opt/claude-seo-UI/screenshots/salehoo_mobile.png", 375, 812)
    print("Done: salehoo_mobile.png")

    print("Extracting metadata and page signals...")
    data = extract_metadata(URL)
    print(json.dumps(data, indent=2))
