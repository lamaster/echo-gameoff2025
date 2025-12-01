#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 iCenter;
layout(location = 3) in vec3 iSize;
layout(location = 4) in float iMaterialId;
layout(location = 5) in vec3 iPivot;

uniform mat4 uProjectionMatrix;
uniform vec3 uCameraPosition;
uniform mat3 uCameraRotation;
uniform float uTimeSeconds;

out vec3 vWorld;
out vec3 vNormal;
flat out int vMaterialId;

void main() {
  vec3 halfSize = iSize;
  vec3 local = aPosition * halfSize;
  if (int(iMaterialId + 0.5) == 5) {
    float t = uTimeSeconds * 1.6;
    float ang = t;
    float s = sin(ang);
    float c = cos(ang);
    mat3 rotY = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
    vec3 rel = iCenter + local - iPivot;
    rel = rotY * rel;
    rel.y += 0.05 * sin(t * 1.7 + iCenter.z * 0.3);
    vec3 world = iPivot + rel;
    vWorld = world;
    vNormal = rotY * aNormal;
    vMaterialId = int(iMaterialId + 0.5);
    vec3 cam = transpose(uCameraRotation) * (world - uCameraPosition);
    gl_Position = uProjectionMatrix * vec4(cam, 1.0);
    return;
  }
  vec3 world = iCenter + local;
  vWorld = world;
  vNormal = aNormal;
  vMaterialId = int(iMaterialId + 0.5);
  vec3 cam = transpose(uCameraRotation) * (world - uCameraPosition);
  gl_Position = uProjectionMatrix * vec4(cam, 1.0);
}
