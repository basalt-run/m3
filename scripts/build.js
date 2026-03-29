import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const tokensDir = path.join(rootDir, 'tokens')

// Ensure dist exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true })
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (key.startsWith('$')) continue
    const srcVal = source[key]
    const tgtVal = target[key]
    if (srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal) && srcVal.$value === undefined) {
      if (!tgtVal || typeof tgtVal !== 'object' || tgtVal.$value !== undefined) {
        target[key] = {}
      }
      deepMerge(target[key], srcVal)
    } else {
      target[key] = srcVal
    }
  }
  return target
}

function loadTokens() {
  const tokenFiles = [
    'primitives.json',
    'semantic.light.json',
    'semantic.dark.json'
  ]

  let merged = {}

  tokenFiles.forEach(file => {
    const filePath = path.join(tokensDir, file)
    if (fs.existsSync(filePath)) {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      deepMerge(merged, content)
    }
  })

  return merged
}

function flattenTokens(obj, prefix = '') {
  const flat = {}
  
  Object.entries(obj).forEach(([key, value]) => {
    if (key.startsWith('$')) return
    
    const pathStr = prefix ? `${prefix}.${key}` : key
    
    if (value && typeof value === 'object' && !value.$value) {
      Object.assign(flat, flattenTokens(value, pathStr))
    } else if (value && value.$value) {
      flat[pathStr] = value.$value
    }
  })
  
  return flat
}

function refValToStr(val) {
  if (val === undefined || val === null) return undefined
  if (typeof val === 'object') {
    if (val.offsetX !== undefined) {
      return `${val.offsetX} ${val.offsetY} ${val.blur} ${val.spread} ${val.color}`
    }
    return JSON.stringify(val)
  }
  return String(val)
}

function resolveReferences(flatTokens, maxDepth = 5) {
  const resolved = { ...flatTokens }
  let depth = 0
  let changed = true

  while (changed && depth < maxDepth) {
    changed = false
    depth++

    Object.entries(resolved).forEach(([path, value]) => {
      if (typeof value === 'string' && value.includes('{')) {
        const refPattern = /\{([a-z0-9.-]+)\}/gi
        const newValue = value.replace(refPattern, (match, refPath) => {
          const refKey = refPath.toLowerCase()

          if (resolved[refKey] !== undefined && resolved[refKey] !== match) {
            changed = true
            const refVal = resolved[refKey]
            return typeof refVal === 'object' ? refValToStr(refVal) : refVal
          }

          return match
        })

        resolved[path] = newValue
      }
    })
  }

  if (depth >= maxDepth) {
    console.warn('⚠️  Reference resolution hit max depth. Check for circular references.')
  }

  return resolved
}

function generateTypeScript(tokens) {
  const flatTokens = flattenTokens(tokens)
  const resolvedTokens = resolveReferences(flatTokens)
  const tokenPaths = Object.keys(resolvedTokens)
  
  const unionType = tokenPaths
    .map(pathStr => `'${pathStr}'`)
    .join(' | ')

  const typesFile = `
// Auto-generated types from Basalt tokens
// DO NOT EDIT — regenerated on build

export type TokenPath = ${unionType}

export interface Token {
  path: TokenPath
  value: string | number | object
}

export const tokens: Record<TokenPath, string | number | object> = {
${tokenPaths.map(pathStr => `  '${pathStr}': ${JSON.stringify(resolvedTokens[pathStr])}`).join(',\n')}
}

export default tokens
`

  return typesFile
}

function generateCSS(tokens) {
  const flatTokens = flattenTokens(tokens)
  const resolvedTokens = resolveReferences(flatTokens)

  let css = ':root {\n'

  Object.entries(resolvedTokens).forEach(([pathStr, value]) => {
    const cssVarName = `--${pathStr.replace(/\./g, '-')}`
    const cssValue = typeof value === 'object' 
      ? JSON.stringify(value)
      : value
    
    css += `  ${cssVarName}: ${cssValue};\n`
  })
  
  css += '}\n'
  
  return css
}

function generateTailwindConfig(tokens) {
  const flatTokens = flattenTokens(tokens)
  const resolvedTokens = resolveReferences(flatTokens)

  const grouped = {}
  Object.entries(resolvedTokens).forEach(([pathStr, value]) => {
    const category = pathStr.split('.')[0]
    if (!grouped[category]) grouped[category] = {}
    grouped[category][pathStr] = value
  })

  const colorEntries = Object.entries(grouped.color || {})
    .map(([pathStr, value]) => `          '${pathStr}': '${value}',`)
    .join('\n')

  const spacingEntries = Object.entries(grouped.spacing || {})
    .map(([pathStr, value]) => `          '${pathStr}': '${value}',`)
    .join('\n')

  const radiusEntries = Object.entries(grouped.radius || {})
    .map(([pathStr, value]) => `          '${pathStr}': '${value}',`)
    .join('\n')

  const fontFamilyEntries = Object.entries(grouped.typography?.fontFamily || {})
    .map(([pathStr, value]) => {
      const fontList = Array.isArray(value) ? value.join(', ') : value
      return `          '${pathStr}': '${fontList}',`
    })
    .join('\n')

  const fontSizeEntries = Object.entries(grouped.typography?.fontSize || {})
    .map(([pathStr, value]) => `          '${pathStr}': '${value}',`)
    .join('\n')

  const shadowEntries = Object.entries(grouped.shadow || {})
    .map(([pathStr, value]) => {
      const shadowStr = typeof value === 'object'
        ? `${value.offsetX} ${value.offsetY} ${value.blur} ${value.spread} ${value.color}`
        : value
      return `          '${pathStr}': '${shadowStr}',`
    })
    .join('\n')

  const plugin = `
// Auto-generated Tailwind config from Basalt tokens
// Usage: plugins: [require('@basalt-run/m3/tailwind')()]

module.exports = function() {
  return {
    theme: {
      extend: {
        colors: {
${colorEntries}
        },
        spacing: {
${spacingEntries}
        },
        borderRadius: {
${radiusEntries}
        },
        fontFamily: {
${fontFamilyEntries}
        },
        fontSize: {
${fontSizeEntries}
        },
        shadow: {
${shadowEntries}
        },
      }
    }
  }
}
`

  return plugin
}

// ============================================================================
// STEP 7: Generate React component files from components.json
// ============================================================================

function generateComponentFiles(components) {
  const componentFiles = {}
  const sourceExt = /.(tsx|ts|jsx|js|vue)$/i

  function isRepoSourcePath(p) {
    if (!p || typeof p !== 'string') return false
    const t = p.trim()
    if (!t || t.includes('..') || t.toLowerCase().startsWith('figma:')) return false
    return t.includes('/') || sourceExt.test(t)
  }

  components.forEach((component) => {
    const { name, description = '', variants = {}, props = [], sourcePath } = component

    if (sourcePath && isRepoSourcePath(sourcePath)) {
      const abs = path.join(rootDir, sourcePath)
      if (fs.existsSync(abs)) {
        const raw = fs.readFileSync(abs, 'utf-8')
        const base = path.basename(sourcePath)
        componentFiles[base] = raw
        console.log('✓ Copied repo component', sourcePath, '→ dist/components/' + base)
        return
      }
      console.warn('⚠️  sourcePath not on disk:', sourcePath, '(' + name + ') — generating stub')
    }

    const propsInterface = props.length > 0
      ? props.map(p => {
          const type = p.values ? `'${p.values.join("' | '")}'` : p.type || 'string'
          return `  ${p.name}?: ${type}`
        }).join('\n')
      : ''

    const defaultClasses = []
    const firstVariant = Object.values(variants)[0]
    if (firstVariant) {
      const bindings = firstVariant.tokenBindings || (firstVariant.states?.default?.tokenBindings) || []
      const arr = Array.isArray(bindings) ? bindings : Object.entries(bindings || {}).map(([, b]) => b)
      arr.forEach(b => {
        const pth = b.tokenPath || (b.token_path)
        if (!pth || typeof pth !== 'string') return
        const cssVar = `--${pth.replace(/\./g, '-')}`
        const prefix = (b.tailwindPrefix || '').trim()
        if (prefix) defaultClasses.push(`${prefix}-[var(${cssVar})]`)
      })
    }
    const baseClasses = defaultClasses.length > 0 ? defaultClasses.join(' ') : ''

    const tsx = `'use client'

import React from 'react'

/**
 * ${name}
 * ${description}
 */

interface ${name}Props extends React.HTMLAttributes<HTMLElement> {
${propsInterface}
}

export const ${name} = React.forwardRef<HTMLElement, ${name}Props>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref as React.Ref<HTMLDivElement>}
      className={\`${baseClasses}\${baseClasses && className ? ' ' : ''}\${className || ''}\`}
      {...props}
    />
  )
)

${name}.displayName = '${name}'
export default ${name}
`

    componentFiles[`${name}.tsx`] = tsx
  })

  const barrelParts = []
  for (const filename of Object.keys(componentFiles)) {
    if (filename === 'index.ts') continue
    if (!/\.(tsx|ts)$/i.test(filename)) continue
    const base = filename.replace(/\.(tsx|ts)$/i, '')
    barrelParts.push(`export { default as ${base}, ${base} } from './${base}'`)
  }
  componentFiles['index.ts'] = barrelParts.join('\n')

  return componentFiles
}

function generateIndex(tokens) {
  const flatTokens = flattenTokens(tokens)
  const resolvedTokens = resolveReferences(flatTokens)

  const esmContent = `
// Auto-generated from Basalt tokens
// Usage: import { tokens } from '@basalt-run/m3'

export const tokens = ${JSON.stringify(resolvedTokens, null, 2)}

export default tokens
`

  const cjsContent = `
// Auto-generated from Basalt tokens (CommonJS)
const tokens = ${JSON.stringify(resolvedTokens, null, 2)}

module.exports = { tokens }
module.exports.default = tokens
`

  return { esm: esmContent, cjs: cjsContent }
}

async function build() {
  console.log('📦 Building design system package...')
  
  try {
    const tokens = loadTokens()
    console.log('✓ Loaded tokens from /tokens')

    const tsContent = generateTypeScript(tokens)
    fs.writeFileSync(path.join(distDir, 'index.d.ts'), tsContent)
    console.log('✓ Generated TypeScript types (index.d.ts)')

    const { esm, cjs } = generateIndex(tokens)
    fs.writeFileSync(path.join(distDir, 'index.js'), esm)
    fs.writeFileSync(path.join(distDir, 'index.cjs'), cjs)
    console.log('✓ Generated ESM + CJS exports')

    const cssContent = generateCSS(tokens)
    fs.writeFileSync(path.join(distDir, 'tokens.css'), cssContent)
    console.log('✓ Generated CSS variables (tokens.css)')

    const tailwindContent = generateTailwindConfig(tokens)
    fs.writeFileSync(path.join(distDir, 'tailwind.config.js'), tailwindContent)
    console.log('✓ Generated Tailwind plugin (tailwind.config.js)')

    const componentsPath = path.join(rootDir, 'components.json')
    if (fs.existsSync(componentsPath)) {
      try {
        const componentsJson = JSON.parse(fs.readFileSync(componentsPath, 'utf-8'))
        const components = componentsJson.components || []
        const componentFiles = generateComponentFiles(components)
        const componentsDir = path.join(distDir, 'components')
        if (!fs.existsSync(componentsDir)) {
          fs.mkdirSync(componentsDir, { recursive: true })
        }
        Object.entries(componentFiles).forEach(([filename, content]) => {
          fs.writeFileSync(path.join(componentsDir, filename), content)
        })
        console.log('✓ Generated ' + components.length + ' component files')
      } catch (err) {
        console.warn('⚠️  Could not generate component files:', err.message)
      }
    }

    console.log('\\n✨ Build complete! Ready to publish.')
  } catch (error) {
    console.error('❌ Build failed:', error.message)
    process.exit(1)
  }
}

await build()
