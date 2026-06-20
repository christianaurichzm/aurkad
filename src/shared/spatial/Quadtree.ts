/**
 * Quadtree for spatial partitioning, so collision and viewport queries
 * visit nearby entities instead of all of them.
 */

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface QuadtreeEntity {
  position: Point;
  width: number;
  height: number;
  id?: string;
}

interface QuadtreeNode {
  bounds: Rectangle;
  entities: QuadtreeEntity[];
  children: QuadtreeNode[] | null;
  depth: number;
}

export class Quadtree {
  private root: QuadtreeNode;
  private maxEntities: number;
  private maxDepth: number;

  constructor(
    bounds: Rectangle,
    maxEntities: number = 10,
    maxDepth: number = 8,
  ) {
    this.maxEntities = maxEntities;
    this.maxDepth = maxDepth;
    this.root = {
      bounds,
      entities: [],
      children: null,
      depth: 0,
    };
  }

  /**
   * Insert an entity into the quadtree
   */
  insert(entity: QuadtreeEntity): void {
    this.insertIntoNode(this.root, entity);
  }

  private insertIntoNode(node: QuadtreeNode, entity: QuadtreeEntity): void {
    if (node.children !== null) {
      const index = this.getQuadrant(node, entity);
      if (index !== -1) {
        this.insertIntoNode(node.children[index]!, entity);
        return;
      }
    }

    node.entities.push(entity);

    if (
      node.entities.length > this.maxEntities &&
      node.depth < this.maxDepth &&
      node.children === null
    ) {
      this.split(node);
      this.redistribute(node);
    }
  }

  /**
   * Split a node into 4 children
   */
  private split(node: QuadtreeNode): void {
    const { x, y, width, height } = node.bounds;
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const depth = node.depth + 1;

    node.children = [
      {
        bounds: { x, y, width: halfWidth, height: halfHeight },
        entities: [],
        children: null,
        depth,
      },
      {
        bounds: { x: x + halfWidth, y, width: halfWidth, height: halfHeight },
        entities: [],
        children: null,
        depth,
      },
      {
        bounds: { x, y: y + halfHeight, width: halfWidth, height: halfHeight },
        entities: [],
        children: null,
        depth,
      },
      {
        bounds: {
          x: x + halfWidth,
          y: y + halfHeight,
          width: halfWidth,
          height: halfHeight,
        },
        entities: [],
        children: null,
        depth,
      },
    ];
  }

  /**
   * Redistribute entities after split
   */
  private redistribute(node: QuadtreeNode): void {
    if (node.children === null) return;

    const entitiesToRedistribute = [...node.entities];
    node.entities = [];

    for (const entity of entitiesToRedistribute) {
      const index = this.getQuadrant(node, entity);
      if (index !== -1) {
        this.insertIntoNode(node.children[index]!, entity);
      } else {
        node.entities.push(entity);
      }
    }
  }

  /**
   * Get which quadrant an entity belongs to
   * Returns -1 if entity doesn't fit completely in any quadrant
   */
  private getQuadrant(node: QuadtreeNode, entity: QuadtreeEntity): number {
    if (node.children === null) return -1;

    const { x, y, width, height } = node.bounds;
    const midX = x + width / 2;
    const midY = y + height / 2;

    const entityLeft = entity.position.x;
    const entityRight = entity.position.x + entity.width;
    const entityTop = entity.position.y;
    const entityBottom = entity.position.y + entity.height;

    const inTopHalf = entityBottom <= midY;
    const inBottomHalf = entityTop >= midY;
    const inLeftHalf = entityRight <= midX;
    const inRightHalf = entityLeft >= midX;

    if (inTopHalf && inLeftHalf) return 0;
    if (inTopHalf && inRightHalf) return 1;
    if (inBottomHalf && inLeftHalf) return 2;
    if (inBottomHalf && inRightHalf) return 3;

    return -1;
  }

  /**
   * Query entities in a rectangular area
   */
  query(area: Rectangle): QuadtreeEntity[] {
    const found: QuadtreeEntity[] = [];
    this.queryNode(this.root, area, found);
    return found;
  }

  private queryNode(
    node: QuadtreeNode,
    area: Rectangle,
    found: QuadtreeEntity[],
  ): void {
    if (!this.intersects(node.bounds, area)) {
      return;
    }

    for (const entity of node.entities) {
      if (this.entityIntersectsArea(entity, area)) {
        found.push(entity);
      }
    }

    if (node.children !== null) {
      for (const child of node.children) {
        this.queryNode(child, area, found);
      }
    }
  }

  /**
   * Query entities near a point (within radius)
   */
  queryRadius(point: Point, radius: number): QuadtreeEntity[] {
    const area: Rectangle = {
      x: point.x - radius,
      y: point.y - radius,
      width: radius * 2,
      height: radius * 2,
    };
    return this.query(area);
  }

  /**
   * Check if two rectangles intersect
   */
  private intersects(rect1: Rectangle, rect2: Rectangle): boolean {
    return !(
      rect1.x + rect1.width < rect2.x ||
      rect2.x + rect2.width < rect1.x ||
      rect1.y + rect1.height < rect2.y ||
      rect2.y + rect2.height < rect1.y
    );
  }

  /**
   * Check if entity intersects with area
   */
  private entityIntersectsArea(
    entity: QuadtreeEntity,
    area: Rectangle,
  ): boolean {
    const entityRect: Rectangle = {
      x: entity.position.x,
      y: entity.position.y,
      width: entity.width,
      height: entity.height,
    };
    return this.intersects(entityRect, area);
  }

  /**
   * Clear all entities from the quadtree
   */
  clear(): void {
    this.clearNode(this.root);
  }

  private clearNode(node: QuadtreeNode): void {
    node.entities = [];
    if (node.children !== null) {
      for (const child of node.children) {
        this.clearNode(child);
      }
      node.children = null;
    }
  }

  /**
   * Get total number of entities in the tree
   */
  size(): number {
    return this.sizeNode(this.root);
  }

  private sizeNode(node: QuadtreeNode): number {
    let count = node.entities.length;
    if (node.children !== null) {
      for (const child of node.children) {
        count += this.sizeNode(child);
      }
    }
    return count;
  }

  /**
   * Get statistics about the quadtree (for debugging/profiling)
   */
  getStats(): {
    totalEntities: number;
    maxDepth: number;
    nodeCount: number;
    avgEntitiesPerLeaf: number;
  } {
    const stats = {
      totalEntities: 0,
      maxDepth: 0,
      nodeCount: 0,
      leafCount: 0,
      leafEntities: 0,
    };

    this.collectStats(this.root, stats);

    return {
      totalEntities: stats.totalEntities,
      maxDepth: stats.maxDepth,
      nodeCount: stats.nodeCount,
      avgEntitiesPerLeaf:
        stats.leafCount > 0 ? stats.leafEntities / stats.leafCount : 0,
    };
  }

  private collectStats(
    node: QuadtreeNode,
    stats: {
      totalEntities: number;
      maxDepth: number;
      nodeCount: number;
      leafCount: number;
      leafEntities: number;
    },
  ): void {
    stats.nodeCount++;
    stats.totalEntities += node.entities.length;
    stats.maxDepth = Math.max(stats.maxDepth, node.depth);

    if (node.children === null) {
      stats.leafCount++;
      stats.leafEntities += node.entities.length;
    } else {
      for (const child of node.children) {
        this.collectStats(child, stats);
      }
    }
  }
}
