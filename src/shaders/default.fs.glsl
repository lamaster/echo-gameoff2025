#version 300 es
precision highp float;

out vec4 frag;

in vec3 vWorld;
in vec3 vNormal;
flat in int vMaterialId;

uniform float uTimeSeconds;
uniform vec3 uCameraPosition;
uniform int uDebug;
uniform float uGhost;
uniform float uOutline;
uniform int uWire;
uniform float uGridScale;
uniform float uGridWidth;
uniform int uHeat;
uniform int uReflect;
uniform float uRingFalloff;
uniform float uDoorGlow;
uniform int uPingCount;
const int MAX_PINGS = 8;
uniform vec3 uPingPositions[MAX_PINGS];
uniform float uPingTimes[MAX_PINGS];
uniform float uPingStrengths[MAX_PINGS];
uniform vec4 uMazeBounds; // minX, maxX, minZ, maxZ
uniform float uAfterglowMix;
uniform sampler2D uWaveTexture;
uniform vec2 uWaveTextureSize;
uniform vec2 uWaveOrigin;
uniform float uWaveCellSize;

float saturate(float x) {
  return clamp(x, 0.0, 1.0);
}

vec3 palette(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 a = vec3(0.55, 0.15, 0.1);
  vec3 b = vec3(0.45, 0.55, 0.5);
  vec3 c = vec3(1.0, 1.0, 1.0);
  vec3 d = vec3(0.0, 0.33, 0.67);
  return a + b * cos(6.28318 * (c * t + d));
}

float ringAt(vec3 p) {
  float c = 12.0;
  float acc = 0.0;
  for (int i = 0; i < MAX_PINGS; i++) {
    if (i >= uPingCount) break;
    float t0 = uPingTimes[i];
    float R = (uTimeSeconds - t0) * c;
    float d0 = abs(length(p - uPingPositions[i]) - R);
    float inner = smoothstep(0.06, 0.0, d0);
    float halo = smoothstep(0.12, 0.06, d0);
    float strength = uPingStrengths[i];
    float r = max(inner, 0.5 * halo) * strength;
    if (uReflect == 1) {
      vec3 s = uPingPositions[i];
      vec3 sxp = vec3(2.0 * uMazeBounds.y - s.x, s.y, s.z);
      vec3 sxn = vec3(2.0 * uMazeBounds.x - s.x, s.y, s.z);
      vec3 szp = vec3(s.x, s.y, 2.0 * uMazeBounds.w - s.z);
      vec3 szn = vec3(s.x, s.y, 2.0 * uMazeBounds.z - s.z);
      float g = 0.7 * strength;
      r = max(
        r,
        g *
          max(
            smoothstep(0.06, 0.0, abs(length(p - sxp) - R)),
            0.5 * smoothstep(0.12, 0.06, abs(length(p - sxp) - R))
          )
      );
      r = max(
        r,
        g *
          max(
            smoothstep(0.06, 0.0, abs(length(p - sxn) - R)),
            0.5 * smoothstep(0.12, 0.06, abs(length(p - sxn) - R))
          )
      );
      r = max(
        r,
        g *
          max(
            smoothstep(0.06, 0.0, abs(length(p - szp) - R)),
            0.5 * smoothstep(0.12, 0.06, abs(length(p - szp) - R))
          )
      );
      r = max(
        r,
        g *
          max(
            smoothstep(0.06, 0.0, abs(length(p - szn) - R)),
            0.5 * smoothstep(0.12, 0.06, abs(length(p - szn) - R))
          )
      );
    }
    r *= exp(-uRingFalloff * R);
    acc += r;
  }
  return saturate(acc);
}

float echoBrightness(vec3 p) {
  float c = 12.0;
  float tau = 1.2;
  float b = 0.0;
  for (int i = 0; i < MAX_PINGS; i++) {
    if (i >= uPingCount) break;
    float t0 = uPingTimes[i];
    float passT = t0 + length(p - uPingPositions[i]) / c;
    float dt = uTimeSeconds - passT;
    float e = exp(-max(0.0, dt) / tau);
    b += step(0.0, dt) * e * uPingStrengths[i];
  }
  return clamp(b, 0.0, 1.0);
}

float gridLines(vec3 p, vec3 n, float scale, float width) {
  vec2 uv;
  if (abs(n.y) > 0.5) uv = p.xz;
  else if (abs(n.x) > 0.5) uv = p.zy;
  else uv = p.xy;
  float k = 3.14159265 * scale;
  float gx = 1.0 - smoothstep(0.0, width, abs(sin(uv.x * k)));
  float gy = 1.0 - smoothstep(0.0, width, abs(sin(uv.y * k)));
  return max(gx, gy);
}

void main() {
  vec3 p = vWorld;
  vec3 n = normalize(vNormal);
  float R = ringAt(p);
  float B = echoBrightness(p);
  vec3 viewDir = normalize(uCameraPosition - p);
  float ndv = abs(dot(n, viewDir));
  float face = 1.0 - ndv;
  float edge = smoothstep(0.25, uOutline, face);
  float ghost = uDebug == 1 ? uGhost * (0.5 + 0.5 * edge) : 0.0;
  float Vis = uDebug == 1 ? max(B, ghost) : 0.0;
  vec3 base =
    vMaterialId == 1
      ? vec3(0.12, 0.14, 0.16)
      : vMaterialId == 2
        ? vec3(0.1, 0.11, 0.13)
        : vMaterialId == 3
          ? vec3(0.08, 0.09, 0.1)
          : vMaterialId == 4
            ? vec3(0.38, 0.29, 0.12)
            : vMaterialId == 5
              ? vec3(0.38, 0.29, 0.12)
              : vMaterialId == 6
                ? vec3(0.08, 0.1, 0.12)
                : vMaterialId == 7
                  ? vec3(0.14, 0.5, 1.1)
                  : vec3(0.06, 0.07, 0.08);
  vec3 ringCol = vec3(0.2, 0.75, 1.6);
  float amb = uDebug == 1 ? 0.06 : 0.0;
  vec3 shaded = base * (amb + Vis) + R * ringCol * 0.8;
  vec3 col;
  if (uHeat == 1) {
    float h = clamp(0.7 * (0.35 + 0.65 * B), 0.0, 1.0);
    col = palette(h) + R * vec3(0.6);
  } else {
    col = shaded;
  }
  if (uWire == 1) {
    float g = gridLines(p, n, uGridScale, uGridWidth);
    col = mix(col, vec3(0.25, 0.9, 1.3), 0.25 * g);
  }
  if (vMaterialId == 4 || vMaterialId == 5 || vMaterialId == 7) {
    float pulse =
      0.45 +
      0.55 *
        smoothstep(
          0.0,
          1.0,
          0.5 + 0.5 * sin(uTimeSeconds * (vMaterialId == 7 ? 4.0 : 3.2))
        );
    vec3 glowCol =
      vMaterialId == 5
        ? vec3(0.2, 0.75, 1.6)
        : vMaterialId == 7
          ? vec3(0.26, 0.8, 1.6)
          : vec3(0.2, 0.75, 1.6);
    col = mix(col, glowCol, 0.35 * pulse * uDoorGlow);
  }
  float t = length(p - uCameraPosition);
  float fog = 1.0 - exp(-0.06 * t);
  float dfog = uDebug == 1 ? fog * 0.4 : 0.0;
  col = mix(col, vec3(0.0), dfog * 0.5);
  if (uAfterglowMix > 0.0) {
    vec2 uv = (p.xz - uWaveOrigin) / (uWaveTextureSize * uWaveCellSize);
    float wave = texture(uWaveTexture, uv).r;
    col += wave * ringCol * uAfterglowMix;
  }
  col = pow(col, vec3(0.4545));
  frag = vec4(col, 1.0);
}
