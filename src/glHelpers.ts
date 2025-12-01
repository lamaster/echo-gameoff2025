export function compileShader(gl: WebGL2RenderingContext, type: GLenum, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error('shader create failed');
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`Shader compile failed: ${log || 'unknown error'}`);
  }
  return s;
}

export function linkProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error('program create failed');
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`Program link failed: ${log || 'unknown error'}`);
  }
  return p;
}
