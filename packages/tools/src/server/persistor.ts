import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { generateUsage, type MemoElement } from '@memo/tools';

/**
 * Persists an element change back to its source .sysml file.
 * 
 * If the element is new (no 'file' property), it records it in 'model/generated.sysml'.
 * Uses a regex-based usage block replacement for existing elements.
 */
export function saveElementToFile(cwd: string, element: any): { success: boolean; filePath: string; error?: string } {
    const relativePath = element.file || 'model/generated.sysml';
    const filePath = resolve(cwd, relativePath);

    // 1. Ensure directory exists
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }

    // 2. Initialize file if new
    if (!existsSync(filePath)) {
        const pkgName = relativePath.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_/, '').replace(/\.sysml$/, '');
        writeFileSync(filePath, `package ${pkgName || 'generated'} {\n}\n`, 'utf8');
    }

    const content = readFileSync(filePath, 'utf8');
    
    // Transform element to the format generator expects
    // Note: our current generator expects CsvElement, but we can call generateUsage 
    // with a duck-typed object.
    const newUsage = generateUsage({
        id: element.id,
        name: element.name,
        kind: element.kind,
        construct: element.construct || 'part',
        layer: element.layer || '',
        doc: element.doc || '',
        attributes: element.attributes || {},
    });

    // 3. Find and replace or Append
    // This regex looks for: <construct> <id> : <kind> { ... }
    const escapedId = element.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const usageRegex = new RegExp(
        `(\\w+)\\s+${escapedId}\\s*:\\s*(\\w+)\\s*\\{([^{}]|\\{[^{}]*\\})*\\}`,
        'g'
    );

    const matches = content.match(usageRegex);
    let newContent: string;
    
    const log = (msg: string) => appendFileSync('/tmp/persistor.log', `[${new Date().toISOString()}] ${msg}\n`);
    log(`Persisting ${element.id} to ${filePath}. File length: ${content.length}`);

    if (matches) {
        log(`Found existing definition(s) for ${element.id}. Matching block: ${matches[0].slice(0, 50)}...`);
        newContent = content.replace(usageRegex, newUsage);
    } else {
        log(`No existing definition found for ${element.id}. Current package structure might be missing. Appending at end.`);
        const lastBrace = content.lastIndexOf('}');
        if (lastBrace !== -1) {
            const indentedUsage = newUsage.split('\n').map(l => '    ' + l).join('\n');
            newContent = content.slice(0, lastBrace) + '\n' + indentedUsage + '\n' + content.slice(lastBrace);
        } else {
            newContent = content + '\n' + newUsage + '\n';
        }
    }

    try {
        writeFileSync(filePath, newContent, 'utf8');
        log(`Successfully wrote ${newContent.length} bytes to ${filePath}`);
        return { success: true, filePath: relativePath };
    } catch (e) {
        log(`CRITICAL: Failed to write to ${filePath}: ${e}`);
        return { success: false, filePath: relativePath, error: String(e) };
    }
}

/**
 * Appends a typed relationship connection to model/relationships.sysml.
 * Writes:  connection : RelType connect sourceId to targetId;
 */
export function saveRelationshipToFile(
    cwd: string,
    rel: { sourceId: string; targetId: string; type: string }
): { success: boolean; filePath: string; error?: string } {
    const relativePath = 'model/relationships.sysml';
    const filePath = resolve(cwd, relativePath);
    const dir = dirname(filePath);

    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const typeName = rel.type.charAt(0).toUpperCase() + rel.type.slice(1);
    const line = `    connection : ${typeName} connect ${rel.sourceId} to ${rel.targetId};\n`;

    try {
        if (!existsSync(filePath)) {
            writeFileSync(filePath, `package relationships {\n${line}}\n`, 'utf8');
        } else {
            // Insert before the last closing brace
            const content = readFileSync(filePath, 'utf8');
            const lastBrace = content.lastIndexOf('}');
            const newContent = lastBrace !== -1
                ? content.slice(0, lastBrace) + line + content.slice(lastBrace)
                : content + line;
            writeFileSync(filePath, newContent, 'utf8');
        }
        return { success: true, filePath: relativePath };
    } catch (e) {
        return { success: false, filePath: relativePath, error: String(e) };
    }
}
