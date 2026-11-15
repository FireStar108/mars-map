'use strict';
// Небо Марса: «ирисковое» днём, голубое гало у Солнца на закате, звёзды ночью.
// Солнце — направленный свет с тенями, которые следуют за машиной.
(function (PG) {
  PG.Environment = class {
    constructor(scene) {
      this.scene = scene;
      this.sunDir = new THREE.Vector3(0.3, 0.8, -0.2).normalize();
      this.skyMat = new THREE.ShaderMaterial({
        uniforms: { uSun: { value: this.sunDir } },
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
        fragmentShader: `
          uniform vec3 uSun; varying vec3 vDir;
          void main(){
            vec3 d = normalize(vDir); float el = uSun.y;
            float day = smoothstep(-0.12, 0.25, el);
            float h = clamp(d.y, 0.0, 1.0);
            vec3 zen = vec3(0.36, 0.235, 0.17), hor = vec3(0.67, 0.47, 0.34);
            vec3 col = mix(hor, zen, pow(h, 0.55));
            float cs = max(dot(d, uSun), 0.0);
            // голубое гало вокруг Солнца — сильнее, когда оно низко
            float low = 1.0 - smoothstep(0.0, 0.5, el);
            col = mix(col, vec3(0.42, 0.55, 0.78), pow(cs, 10.0) * (0.04 + 0.75 * low));
            col *= day;
            // ночь
            vec3 night = vec3(0.006, 0.006, 0.012) + vec3(0.03,0.018,0.012) * (1.0 - h);
            col = mix(night, col, day);
            // диск Солнца (на Марсе он ~2/3 земного)
            float disk = smoothstep(0.99992, 0.99997, cs);
            col += vec3(1.6, 1.5, 1.35) * disk * smoothstep(-0.03, 0.02, el);
            col += vec3(0.5,0.4,0.3) * pow(cs, 600.0) * smoothstep(-0.05, 0.05, el);
            // под горизонтом — земля в дымке
            col = d.y < 0.0 ? mix(col, hor * 0.6 * day + night, (1.0 - smoothstep(-0.05, 0.0, d.y))) : col;
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        side: THREE.BackSide, depthWrite: false, fog: false,
      });
      this.sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), this.skyMat);
      this.sky.frustumCulled = false;
      this.sky.renderOrder = -10;
      scene.add(this.sky);

      // звёзды
      const R = PG.rng(5), n = 2400, pos = new Float32Array(n * 3), sz = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const u = R() * 2 - 1, a = R() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        pos.set([Math.cos(a) * s * 3800, Math.abs(u) * 3800, Math.sin(a) * s * 3800], i * 3);
        sz[i] = 0.6 + R() ** 6 * 3.5;
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      sg.setAttribute('size', new THREE.BufferAttribute(sz, 1));
      this.starMat = new THREE.ShaderMaterial({
        uniforms: { uOpacity: { value: 0 } },
        vertexShader: `attribute float size; void main(){ vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0);
          gl_Position = p.xyww; gl_PointSize = size; }`,
        fragmentShader: `uniform float uOpacity; void main(){ float d = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4(vec3(1.0, 0.95, 0.9), uOpacity * smoothstep(0.5, 0.1, d)); }`,
        transparent: true, depthWrite: false, fog: false,
      });
      this.stars = new THREE.Points(sg, this.starMat);
      this.stars.frustumCulled = false;
      this.stars.renderOrder = -9;
      scene.add(this.stars);

      this.sun = new THREE.DirectionalLight(0xffe2c4, 3);
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      const sc = this.sun.shadow.camera;
      sc.left = -28; sc.right = 28; sc.top = 28; sc.bottom = -28; sc.near = 1; sc.far = 400;
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.03;
      scene.add(this.sun, this.sun.target);
      this.hemi = new THREE.HemisphereLight(0xc49270, 0x4a2a1c, 0.9);
      scene.add(this.hemi);
      scene.fog = new THREE.Fog(0xa07050, 240, 1800);
      this.fogDay = new THREE.Color(0xa77552);
      this.fogNight = new THREE.Color(0x07060a);
    }

    update(sunDir, focus) {
      this.sunDir.copy(sunDir);
      const el = sunDir.y;
      const day = PG.clamp((el + 0.08) / 0.3, 0, 1);
      this.sun.position.copy(focus).addScaledVector(sunDir, 150);
      this.sun.target.position.copy(focus);
      this.sun.intensity = 3.2 * PG.clamp(el * 4, 0, 1);
      this.sun.color.setRGB(1, 0.86 + 0.08 * day, 0.72 + 0.12 * day);
      this.hemi.intensity = 0.06 + 0.9 * day;
      this.starMat.uniforms.uOpacity.value = 1 - PG.clamp((el + 0.12) / 0.15, 0, 1);
      this.scene.fog.color.copy(this.fogNight).lerp(this.fogDay, day);
      this.sky.position.copy(focus);
      this.stars.position.copy(focus);
    }
  };
})(window.PG);
