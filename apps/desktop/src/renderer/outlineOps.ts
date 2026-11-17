/** Pure edits on the bookmark tree. Every function returns a new tree and leaves the input alone. */
import type { OutlineNode } from './edits.js';

type Tree = OutlineNode[];

/** Path of indices to a node, or null. */
export function findPath(tree: Tree, id: string): number[] | null {
  for (let i = 0; i < tree.length; i++) {
    if (tree[i]!.id === id) return [i];
    const sub = findPath(tree[i]!.children, id);
    if (sub) return [i, ...sub];
  }
  return null;
}

function listAt(tree: Tree, parentPath: number[]): Tree {
  let list = tree;
  for (const i of parentPath) list = list[i]!.children;
  return list;
}

/** Replace the list at parentPath using fn, copying only the nodes on the way down. */
function withList(tree: Tree, parentPath: number[], fn: (list: Tree) => Tree): Tree {
  if (!parentPath.length) return fn(tree);
  const [i, ...rest] = parentPath as [number, ...number[]];
  return tree.map((n, k) => (k === i ? { ...n, children: withList(n.children, rest, fn) } : n));
}

export function update(tree: Tree, id: string, patch: Partial<Pick<OutlineNode, 'title' | 'pageId'>>): Tree {
  const path = findPath(tree, id);
  if (!path) return tree;
  return withList(tree, path.slice(0, -1), (list) => list.map((n, k) => (k === path.at(-1) ? { ...n, ...patch } : n)));
}

export function remove(tree: Tree, id: string): Tree {
  const path = findPath(tree, id);
  if (!path) return tree;
  return withList(tree, path.slice(0, -1), (list) => list.filter((_, k) => k !== path.at(-1)));
}

/** Insert after the node `afterId` at the same level, or at the end of the top level. */
export function insertAfter(tree: Tree, afterId: string | null, node: OutlineNode): Tree {
  const path = afterId ? findPath(tree, afterId) : null;
  if (!path) return [...tree, node];
  const at = path.at(-1)! + 1;
  return withList(tree, path.slice(0, -1), (list) => [...list.slice(0, at), node, ...list.slice(at)]);
}

/** Move up or down among its siblings. */
export function move(tree: Tree, id: string, dir: -1 | 1): Tree {
  const path = findPath(tree, id);
  if (!path) return tree;
  const i = path.at(-1)!, j = i + dir;
  return withList(tree, path.slice(0, -1), (list) => {
    if (j < 0 || j >= list.length) return list;
    const copy = [...list];
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    return copy;
  });
}

/** Make it the last child of its previous sibling. */
export function indent(tree: Tree, id: string): Tree {
  const path = findPath(tree, id);
  if (!path || path.at(-1) === 0) return tree;
  const i = path.at(-1)!;
  const node = listAt(tree, path.slice(0, -1))[i]!;
  return withList(tree, path.slice(0, -1), (list) => list
    .map((n, k) => (k === i - 1 ? { ...n, children: [...n.children, node] } : n))
    .filter((_, k) => k !== i));
}

/** Move it out of its parent, right after the parent. */
export function outdent(tree: Tree, id: string): Tree {
  const path = findPath(tree, id);
  if (!path || path.length < 2) return tree;
  const node = listAt(tree, path.slice(0, -1))[path.at(-1)!]!;
  const parentPath = path.slice(0, -1);
  const without = withList(tree, parentPath, (list) => list.filter((_, k) => k !== path.at(-1)));
  const at = parentPath.at(-1)! + 1;
  return withList(without, parentPath.slice(0, -1), (list) => [...list.slice(0, at), node, ...list.slice(at)]);
}
