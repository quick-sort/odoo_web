/** @odoo-module */

import { Component, onWillUnmount, useEffect, useRef, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { standardFieldProps } from "@web/views/fields/standard_field_props";
import { useService } from "@web/core/utils/hooks";
import { _t } from "@web/core/l10n/translation";

const DEFAULTS = {
    height: 400,
    background: "#f0f0f0",
    auto_rotate: false,
    wireframe: false,
    grid: true,
    model_color: "#6c8ebf",
    ambient_intensity: 0.6,
    directional_intensity: 0.8,
};

/**
 * Detect the 3D model format from filename extension or binary content sniffing.
 */
function detectFormat(filename, base64Data) {
    if (filename) {
        const ext = filename.rsplit ? filename.split(".").pop().toLowerCase() : filename.split(".").pop().toLowerCase();
        if (["stl", "obj", "gltf", "glb"].includes(ext)) {
            return ext;
        }
    }
    // Sniff binary content
    if (base64Data) {
        // GLB starts with magic bytes "glTF" (0x676C5446)
        try {
            const raw = atob(base64Data.slice(0, 20));
            if (raw.startsWith("glTF")) return "glb";
            if (raw.startsWith("{")) return "gltf";
            // STL ASCII starts with "solid"
            if (raw.trimStart().startsWith("solid")) return "stl";
        } catch (e) {
            // ignore
        }
        // Default to STL binary (most common for 3D printing)
        return "stl";
    }
    return null;
}

/**
 * Convert base64 to ArrayBuffer.
 */
function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Convert base64 to text string (for ASCII formats like OBJ, ASCII STL, GLTF JSON).
 */
function base64ToText(base64) {
    return atob(base64);
}

export class ThreeDViewerField extends Component {
    setup() {
        this.containerRef = useRef("viewer");
        this.fileInputRef = useRef("fileInput");
        this.notification = useService("notification");

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.animationId = null;
        this.currentModel = null;

        this.state = useState({
            isLoading: false,
            hasModel: false,
            error: null,
            isFullscreen: false,
            showWireframe: this.opts.wireframe,
        });

        // Setup the Three.js scene once when mounted
        useEffect(
            () => {
                this.setupScene();
                this.loadModel();
                return () => this.destroyScene();
            },
            () => []
        );

        // Reload model whenever the field value changes
        useEffect(
            () => {
                if (this.scene) {
                    this.loadModel();
                }
            },
            () => [this.props.record.data[this.props.name]]
        );

        onWillUnmount(() => this.destroyScene());
    }

    get opts() {
        return Object.assign({}, DEFAULTS, this.props.options || {});
    }

    get containerStyle() {
        return `height:${this.opts.height}px;`;
    }

    get hasValue() {
        return !!this.props.record.data[this.props.name];
    }

    get isReadonly() {
        return this.props.readonly;
    }

    get filename() {
        // Try to get filename from the filename field (if configured via `filename` attribute)
        if (this.props.filenameField) {
            return this.props.record.data[this.props.filenameField] || "";
        }
        return "";
    }

    // =========================================================================
    // Three.js Scene Setup
    // =========================================================================

    setupScene() {
        const container = this.containerRef.el;
        if (!container || !window.THREE) return;

        const THREE = window.THREE;
        const width = container.clientWidth || 600;
        const height = container.clientHeight || this.opts.height;

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(this.opts.background);

        // Camera
        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
        this.camera.position.set(5, 5, 5);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        container.appendChild(this.renderer.domElement);

        // Controls
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.1;
        this.controls.autoRotate = this.opts.auto_rotate;
        this.controls.autoRotateSpeed = 2.0;

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, this.opts.ambient_intensity);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, this.opts.directional_intensity);
        dirLight.position.set(5, 10, 7);
        dirLight.castShadow = true;
        this.scene.add(dirLight);

        const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
        dirLight2.position.set(-5, -3, -5);
        this.scene.add(dirLight2);

        // Grid helper
        if (this.opts.grid) {
            const grid = new THREE.GridHelper(20, 20, 0xcccccc, 0xe0e0e0);
            grid.material.opacity = 0.5;
            grid.material.transparent = true;
            this.scene.add(grid);
        }

        // Resize observer
        this._resizeObserver = new ResizeObserver(() => this._onResize());
        this._resizeObserver.observe(container);

        // Start render loop
        this._animate();
    }

    _animate() {
        if (!this.renderer) return;
        this.animationId = requestAnimationFrame(() => this._animate());
        if (this.controls) {
            this.controls.update();
        }
        this.renderer.render(this.scene, this.camera);
    }

    _onResize() {
        const container = this.containerRef.el;
        if (!container || !this.camera || !this.renderer) return;

        const width = container.clientWidth;
        const height = container.clientHeight;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    destroyScene() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        if (this.controls) {
            this.controls.dispose();
            this.controls = null;
        }
        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement && this.renderer.domElement.parentElement) {
                this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
            }
            this.renderer = null;
        }
        if (this.scene) {
            this._disposeObject(this.scene);
            this.scene = null;
        }
        this.camera = null;
        this.currentModel = null;
    }

    _disposeObject(obj) {
        if (!obj) return;
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            if (Array.isArray(obj.material)) {
                obj.material.forEach((m) => m.dispose());
            } else {
                obj.material.dispose();
            }
        }
        if (obj.children) {
            for (const child of [...obj.children]) {
                this._disposeObject(child);
            }
        }
    }

    // =========================================================================
    // Model Loading
    // =========================================================================

    async loadModel() {
        const base64Data = this.props.record.data[this.props.name];
        if (!base64Data || !this.scene) {
            this.state.hasModel = false;
            return;
        }

        const THREE = window.THREE;
        if (!THREE) return;

        this.state.isLoading = true;
        this.state.error = null;

        // Remove previous model
        if (this.currentModel) {
            this.scene.remove(this.currentModel);
            this._disposeObject(this.currentModel);
            this.currentModel = null;
        }

        try {
            const format = detectFormat(this.filename, base64Data);
            let object3d = null;

            switch (format) {
                case "stl":
                    object3d = this._loadSTL(base64Data);
                    break;
                case "obj":
                    object3d = this._loadOBJ(base64Data);
                    break;
                case "gltf":
                case "glb":
                    object3d = await this._loadGLTF(base64Data, format);
                    break;
                default:
                    // Try STL as fallback
                    object3d = this._loadSTL(base64Data);
                    break;
            }

            if (object3d) {
                this.currentModel = object3d;
                this.scene.add(object3d);
                this._fitCameraToObject(object3d);
                this.state.hasModel = true;

                if (this.state.showWireframe) {
                    this._applyWireframe(true);
                }
            }
        } catch (e) {
            console.error("3D model load error:", e);
            this.state.error = e.message || "Failed to load 3D model";
        } finally {
            this.state.isLoading = false;
        }
    }

    _loadSTL(base64Data) {
        const THREE = window.THREE;
        const loader = new THREE.STLLoader();
        const buffer = base64ToArrayBuffer(base64Data);
        const geometry = loader.parse(buffer);

        const material = new THREE.MeshPhongMaterial({
            color: new THREE.Color(this.opts.model_color),
            specular: 0x444444,
            shininess: 30,
            flatShading: false,
        });

        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
    }

    _loadOBJ(base64Data) {
        const THREE = window.THREE;
        const loader = new THREE.OBJLoader();
        const text = base64ToText(base64Data);
        const object = loader.parse(text);

        // Apply default material to meshes without one
        const material = new THREE.MeshPhongMaterial({
            color: new THREE.Color(this.opts.model_color),
            specular: 0x444444,
            shininess: 30,
        });

        object.traverse((child) => {
            if (child.isMesh) {
                if (!child.material || child.material.type === "MeshBasicMaterial") {
                    child.material = material;
                }
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        return object;
    }

    async _loadGLTF(base64Data, format) {
        const THREE = window.THREE;
        const loader = new THREE.GLTFLoader();

        return new Promise((resolve, reject) => {
            const buffer = base64ToArrayBuffer(base64Data);

            if (format === "glb") {
                loader.parse(
                    buffer,
                    "",
                    (gltf) => resolve(gltf.scene),
                    (error) => reject(error)
                );
            } else {
                // GLTF JSON
                const text = base64ToText(base64Data);
                try {
                    const json = JSON.parse(text);
                    // For standalone .gltf without external resources
                    loader.parse(
                        JSON.stringify(json),
                        "",
                        (gltf) => resolve(gltf.scene),
                        (error) => reject(error)
                    );
                } catch (e) {
                    reject(new Error("Invalid GLTF JSON: " + e.message));
                }
            }
        });
    }

    /**
     * Auto-frame the camera to fit the loaded model.
     */
    _fitCameraToObject(object) {
        const THREE = window.THREE;
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        // Center the model on the grid
        object.position.sub(center);
        // Place it on the grid (y=0)
        const box2 = new THREE.Box3().setFromObject(object);
        object.position.y -= box2.min.y;

        // Adjust camera distance
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this.camera.fov * (Math.PI / 180);
        const distance = maxDim / (2 * Math.tan(fov / 2)) * 1.5;

        this.camera.position.set(distance * 0.8, distance * 0.6, distance * 0.8);
        this.camera.lookAt(0, size.y * 0.3, 0);

        // Update controls target
        if (this.controls) {
            this.controls.target.set(0, size.y * 0.3, 0);
            this.controls.update();
        }

        // Adjust near/far planes
        this.camera.near = distance * 0.01;
        this.camera.far = distance * 100;
        this.camera.updateProjectionMatrix();
    }

    // =========================================================================
    // User Interactions
    // =========================================================================

    toggleWireframe() {
        this.state.showWireframe = !this.state.showWireframe;
        this._applyWireframe(this.state.showWireframe);
    }

    _applyWireframe(enable) {
        if (!this.currentModel) return;
        this.currentModel.traverse((child) => {
            if (child.isMesh && child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach((m) => (m.wireframe = enable));
                } else {
                    child.material.wireframe = enable;
                }
            }
        });
    }

    toggleAutoRotate() {
        if (this.controls) {
            this.controls.autoRotate = !this.controls.autoRotate;
        }
    }

    resetCamera() {
        if (this.currentModel) {
            this._fitCameraToObject(this.currentModel);
        }
    }

    toggleFullscreen() {
        const container = this.containerRef.el;
        if (!container) return;

        if (!document.fullscreenElement) {
            container.requestFullscreen().then(() => {
                this.state.isFullscreen = true;
            }).catch(() => {});
        } else {
            document.exitFullscreen().then(() => {
                this.state.isFullscreen = false;
            }).catch(() => {});
        }
    }

    // =========================================================================
    // File Upload
    // =========================================================================

    onUploadClick() {
        if (this.fileInputRef.el) {
            this.fileInputRef.el.click();
        }
    }

    async onFileChange(ev) {
        const file = ev.target.files && ev.target.files[0];
        if (!file) return;

        const validExts = [".stl", ".obj", ".gltf", ".glb"];
        const ext = "." + file.name.split(".").pop().toLowerCase();
        if (!validExts.includes(ext)) {
            this.notification.add(
                _t("Unsupported file format. Please use STL, OBJ, GLTF, or GLB files."),
                { type: "warning" }
            );
            return;
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            const base64 = e.target.result.split(",")[1];
            // Update the record field
            await this.props.record.update({
                [this.props.name]: base64,
            });
            // Update filename field if configured
            if (this.props.filenameField) {
                await this.props.record.update({
                    [this.props.filenameField]: file.name,
                });
            }
        };
        reader.readAsDataURL(file);

        // Reset the input so the same file can be re-uploaded
        ev.target.value = "";
    }

    onDragOver(ev) {
        ev.preventDefault();
        ev.stopPropagation();
    }

    async onDrop(ev) {
        ev.preventDefault();
        ev.stopPropagation();

        if (this.isReadonly) return;

        const file = ev.dataTransfer.files && ev.dataTransfer.files[0];
        if (!file) return;

        const validExts = [".stl", ".obj", ".gltf", ".glb"];
        const ext = "." + file.name.split(".").pop().toLowerCase();
        if (!validExts.includes(ext)) {
            this.notification.add(
                _t("Unsupported file format. Please use STL, OBJ, GLTF, or GLB files."),
                { type: "warning" }
            );
            return;
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            const base64 = e.target.result.split(",")[1];
            await this.props.record.update({
                [this.props.name]: base64,
            });
            if (this.props.filenameField) {
                await this.props.record.update({
                    [this.props.filenameField]: file.name,
                });
            }
        };
        reader.readAsDataURL(file);
    }

    onClear() {
        this.props.record.update({
            [this.props.name]: false,
        });
        if (this.props.filenameField) {
            this.props.record.update({
                [this.props.filenameField]: false,
            });
        }
    }
}

ThreeDViewerField.template = "web_widget_3d_viewer.ThreeDViewerField";
ThreeDViewerField.props = {
    ...standardFieldProps,
    options: { type: Object, optional: true },
    filenameField: { type: String, optional: true },
};
ThreeDViewerField.defaultProps = {
    options: {},
};

export const threeDViewerField = {
    component: ThreeDViewerField,
    supportedTypes: ["binary"],
    extractProps({ attrs, options }) {
        return {
            options,
            filenameField: attrs.filename || "",
        };
    },
};

registry.category("fields").add("3d_viewer", threeDViewerField);
