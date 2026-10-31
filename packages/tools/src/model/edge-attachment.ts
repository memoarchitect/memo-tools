// A saved connector route is only good for the ends it was drawn between. The layout used to
// repeat both ends and both ports, four long qualified ids per connector, to answer that; this is
// the same answer in one short token, written by the layout writer and checked by the canvas.

export interface EdgeEnds {
    source?: string;
    target?: string;
    sourcePortId?: string;
    targetPortId?: string;
}

/** FNV-1a over the four ids, eight hex digits. Not a secret: it only has to change when an end does. */
export function edgeAttachment(ends: EdgeEnds): string {
    const text = [ends.source, ends.target, ends.sourcePortId, ends.targetPortId].map(part => part ?? '').join('\u0000');
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}
