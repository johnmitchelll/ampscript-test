// inline-css.js
const fs = require('fs/promises')
const cheerio = require('cheerio')
const css = require('css')

function parseInlineStyle(s) {
  const out = {}
  if (!s) return out
  s.split(';').forEach(p => {
    const i = p.indexOf(':')
    if (i > -1) {
      const k = p.slice(0, i).trim().toLowerCase()
      const v = p.slice(i + 1).trim()
      if (k) out[k] = v
    }
  })
  return out
}

function spec(selector) {
  if (/[ >+~:[\]]/.test(selector)) return null
  const ids = (selector.match(/#/g) || []).length
  const classes = (selector.match(/\./g) || []).length
  const tag = selector.replace(/[#.].*$/, '').trim()
  const hasTag = tag && tag !== '*'
  return ids * 100 + classes * 10 + (hasTag ? 1 : 0)
}

function matchesSimple(el, selector, $) {
  if (selector.startsWith('#')) return $(el).attr('id') === selector.slice(1)
  if (selector.startsWith('.')) return $(el).hasClass(selector.slice(1))
  return el.tagName && el.tagName.toLowerCase() === selector.toLowerCase()
}

async function inline(htmlPath, cssPath, outPath) {
  const html = await fs.readFile(htmlPath, 'utf8')
  const cssText = await fs.readFile(cssPath, 'utf8')
  const $ = cheerio.load(html)
  const ast = css.parse(cssText)

  const flatRules = []
  let order = 0
  for (const rule of ast.stylesheet.rules) {
    if (rule.type === 'rule') {
      for (const sel of rule.selectors || []) {
        const s = spec(sel.trim())
        if (s == null) continue
        const decls = rule.declarations?.filter(d => d.type === 'declaration') || []
        if (!decls.length) continue
        flatRules.push({ selector: sel.trim(), specificity: s, decls, order: order++ })
      }
    }
  }

  const elements = $('*').toArray()
  for (const el of elements) {
    const styleMap = {}
    const existing = parseInlineStyle($(el).attr('style'))
    for (const k of Object.keys(existing)) styleMap[k] = { value: existing[k], spec: 1e9, order: 1e9 }

    for (const r of flatRules) {
      if (!matchesSimple(el, r.selector, $)) continue
      for (const d of r.decls) {
        const k = d.property.toLowerCase()
        const v = d.value
        const cur = styleMap[k]
        if (!cur || r.specificity > cur.spec || (r.specificity === cur.spec && r.order > cur.order)) {
          styleMap[k] = { value: v, spec: r.specificity, order: r.order }
        }
      }
    }

    if (Object.keys(styleMap).length) {
      const styleString = Object.entries(styleMap)
        .map(([k, o]) => `${k}: ${o.value}`)
        .join('; ')
      $(el).attr('style', styleString)
    }
  }

  await fs.writeFile(outPath, $.html(), 'utf8')
}

if (require.main === module) {
  const [htmlPath, cssPath, outPath] = process.argv.slice(2)
  if (!htmlPath || !cssPath || !outPath) {
    console.error('Usage: node inline-css.js input.html input.css output.html')
    process.exit(1)
  }
  inline(htmlPath, cssPath, outPath).catch(e => {
    console.error(e)
    process.exit(1)
  })
}
