export interface RawNode {
  skill?: number;
  name?: string;
  icon?: string;
  stats?: string[];
  reminderText?: string[];
  flavourText?: string[];
  isNotable?: boolean;
  isKeystone?: boolean;
  isMastery?: boolean;
  isWormhole?: boolean;
  group?: number;
  orbit?: number;
  orbitIndex?: number;
  in?: string[];
  out?: string[];
  /**
   * 3.30+: a notable whose effect the player picks from a list. `stats` then
   * holds only a prompt (or nothing); the real lines are in `variantEffects`.
   */
  isMultipleChoiceVariant?: boolean;
  variantEffects?: { effect: number; stats: string[] }[];
  /**
   * 3.30+: links drawn as an arc around an explicit centre, often between two
   * groups. Links not listed here are straight lines or same-orbit arcs.
   */
  connections?: { to: string; orbit: number; orbitX: number; orbitY: number }[];
}

export interface RawGroup {
  x: number;
  y: number;
  orbits: number[];
  nodes: string[];
  background?: { image: string; offsetX?: number; offsetY?: number; isHalfImage?: boolean };
}

export interface SpriteCoord {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpriteSheet {
  filename: string;
  w: number;
  h: number;
  coords: Record<string, SpriteCoord>;
}

export interface RawTree {
  tree: string;
  groups: Record<string, RawGroup>;
  nodes: Record<string, RawNode>;
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
  constants: {
    skillsPerOrbit: number[];
    orbitRadii: number[];
    PSSCentreInnerRadius: number;
  };
  sprites: Record<string, Record<string, SpriteSheet>>;
  imageZoomLevels: number[];
  points: { totalPoints: number; ascendancyPoints: number };
}

export type NodeKind =
  | 'normal'
  | 'notable'
  | 'keystone'
  | 'wormhole'
  | 'mastery'
  | 'root'
  /** a junction with no name, stats or icon — free, and not a real passive */
  | 'structural';

/** A node prepared for rendering + graph work. `idx` is the graph index. */
export interface TreeNode {
  idx: number;
  id: string;
  name: string;
  icon: string;
  stats: string[];
  /**
   * The effects a multiple-choice notable lets you pick from, one list of
   * lines per choice. Empty for every other node. Which one a plan uses is not
   * known, so these are shown and searched but never added up.
   */
  variants: string[][];
  reminder: string[];
  flavour: string[];
  kind: NodeKind;
  /** mastery nodes are decoration only — not allocatable, not in the graph */
  allocatable: boolean;
  /**
   * Whether taking this node spends a point. False for the centre and for the
   * junction beside it, which are part of every tree but cost nothing — counting
   * them made a full tree read as 138 points when the game charges 137.
   */
  costsPoint: boolean;
  group: number;
  orbit: number;
  orbitIndex: number;
  x: number;
  y: number;
  /** hit-test / draw radius in tree units */
  radius: number;
  /** extra atlas points this node itself grants when allocated (usually 0) */
  grantsPoints: number;
  searchText: string;
  /**
   * What sets the options of a multiple-choice node apart, lower case: each
   * option with the wording all of them share cut away, e.g. "mercenary" and
   * "rogue exile" on Merged Worlds. Empty for an ordinary node.
   */
  choiceText: string;
}

export interface Edge {
  a: number;
  b: number;
  /** same group + same orbit => rendered as an arc along the orbit */
  arc: boolean;
  cx: number;
  cy: number;
  r: number;
  a0: number;
  a1: number;
  anticlockwise: boolean;
}

export interface GroupInfo {
  id: number;
  x: number;
  y: number;
  background?: { image: string; offsetX?: number; offsetY?: number };
}

export interface Tree {
  raw: RawTree;
  nodes: TreeNode[];
  byId: Map<string, TreeNode>;
  edges: Edge[];
  /** CSR adjacency over node indices (mastery nodes have no neighbours) */
  offsets: Int32Array;
  adjacency: Int32Array;
  rootIdx: number;
  /**
   * Allocatable nodes sorted by numeric id — the positional numbering share
   * codes use. Derived from the tree data alone, so it is identical for every
   * client on the same tree version.
   */
  shareOrder: number[];
  /** inverse of shareOrder: node index -> position, -1 when not shareable */
  shareIndex: Int32Array;
  groups: GroupInfo[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  totalPoints: number;
  /** How the Atlas painting sits under this tree; see AtlasTreeVersion.art. */
  art?: ArtPlacement;
}

/**
 * 'hanging': the 3.29 painting, hung from the top of the tree by hand-measured
 * numbers. 'centred': a square painting whose rings are centred on the Atlas
 * centre, drawn `size` tree units across.
 */
export type ArtPlacement = { kind: 'hanging' } | { kind: 'centred'; size: number };
