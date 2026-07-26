export class Particle {
  active = false;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  size = 0;
  color = "#ffffff";
  alpha = 1;
  life = 0;
  maxLife = 1;

  spawn(x: number, y: number, color: string) {
    this.active = true;
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 4.0;
    this.vy = -(Math.random() * 4.5 + 2.0);
    this.size = Math.random() * 3.5 + 1.5;
    this.color = color;
    this.alpha = 1;
    this.life = 0;
    this.maxLife = Math.random() * 0.4 + 0.2;
  }

  update(dt: number) {
    if (!this.active) return;
    this.life += dt;
    if (this.life >= this.maxLife) {
      this.active = false;
      return;
    }
    this.x += this.vx;
    this.y += this.vy;
    this.vy += 3.5 * dt;
    const progress = this.life / this.maxLife;
    this.alpha = 1 - progress;
  }

  draw(ctx: CanvasRenderingContext2D) {
    if (!this.active) return;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export class ParticlePool {
  private pool: Particle[];

  constructor(size = 900) {
    this.pool = Array.from({ length: size }, () => new Particle());
  }

  emit(x: number, y: number, color: string, count = 2) {
    let spawned = 0;
    for (const particle of this.pool) {
      if (!particle.active) {
        particle.spawn(x, y, color);
        spawned++;
        if (spawned >= count) break;
      }
    }
  }

  updateAndDraw(ctx: CanvasRenderingContext2D, dt: number) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const particle of this.pool) {
      if (particle.active) {
        particle.update(dt);
        particle.draw(ctx);
      }
    }
    ctx.restore();
  }
}
