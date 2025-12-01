import { describe, expect, it } from 'bun:test';
import { Material, MazeStart, Walls } from '../materials';
import { moveWithCollisions } from '../physics';
import { createState } from '../state';

describe('moveWithCollisions', () => {
  it('keeps player radius away from wall when moving into it', () => {
    const state = createState();
    const wall = Walls[0];
    state.controller.state.position.x = wall.cx - wall.hx - 0.1; // start slightly left of wall
    state.controller.state.position.z = wall.cz;

    moveWithCollisions(state, 0.5, 0); // attempt to move through the wall

    const nearestX = wall.cx + wall.hx;
    const distanceFromSurface = Math.abs(state.controller.state.position.x - nearestX);
    expect(distanceFromSurface).toBeGreaterThanOrEqual(0.24); // ~PLAYER_R
  });

  it('allows unobstructed movement when far from walls', () => {
    const state = createState();
    state.controller.state.position.x = MazeStart.x;
    state.controller.state.position.z = MazeStart.z;
    const dx = 0.2;
    const dz = 0.2;

    moveWithCollisions(state, dx, dz);

    expect(state.controller.state.position.x).toBeCloseTo(MazeStart.x + dx);
    expect(state.controller.state.position.z).toBeCloseTo(MazeStart.z + dz);
  });

  it('reports zero actual movement when pushing into a wall', () => {
    const originalWalls = [...Walls];
    Walls.splice(0, Walls.length, {
      cx: 0,
      cy: 1.2,
      cz: 0,
      hx: 0.5,
      hy: 1.2,
      hz: 0.5,
      mat: Material.INNER,
    });
    try {
      const state = createState();
      state.controller.state.position.x = -0.75;
      state.controller.state.position.z = 0;

      const res = moveWithCollisions(state, 0.2, 0);

      expect(Math.hypot(res.deltaX, res.deltaZ)).toBeLessThan(0.05);
    } finally {
      Walls.splice(0, Walls.length, ...originalWalls);
    }
  });
});
