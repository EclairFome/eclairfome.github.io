var C=Object.create;var y=Object.defineProperty;var P=Object.getOwnPropertyDescriptor;var N=Object.getOwnPropertyNames;var V=Object.getPrototypeOf,D=Object.prototype.hasOwnProperty;var i=(e,n)=>()=>{try{return n||e((n={exports:{}}).exports,n),n.exports}catch(t){throw n=0,t}};var M=(e,n,t,l)=>{if(n&&typeof n=="object"||typeof n=="function")for(let o of N(n))!D.call(e,o)&&o!==t&&y(e,o,{get:()=>n[o],enumerable:!(l=P(n,o))||l.enumerable});return e};var c=(e,n,t)=>(t=e!=null?C(V(e)):{},M(n||!e||!e.__esModule?y(t,"default",{value:e,enumerable:!0}):t,e));
var p=i((H,s)=>{s.exports=luna?.core?.modules?.["@luna/lib"];if(s.exports===void 0)throw new Error("Cannot find module @luna/lib in luna.core.modules");luna.core.LunaPlugin.getByName("@luna/lib")?.addDependant(luna.core.LunaPlugin.getByName("VolumeScroll"))});
var S=i((U,g)=>{g.exports=luna?.core?.modules?.["@luna/core"];if(g.exports===void 0)throw new Error("Cannot find module @luna/core in luna.core.modules");luna.core.LunaPlugin.getByName("@luna/core")?.addDependant(luna.core.LunaPlugin.getByName("VolumeScroll"))});
var B=i((k,h)=>{h.exports=luna?.core?.modules?.["@luna/ui"];if(h.exports===void 0)throw new Error("Cannot find module @luna/ui in luna.core.modules");luna.core.LunaPlugin.getByName("@luna/ui")?.addDependant(luna.core.LunaPlugin.getByName("VolumeScroll"))});
var L=i((A,f)=>{f.exports=luna?.core?.modules?.react;if(f.exports===void 0)throw new Error("Cannot find module react in luna.core.modules");luna.core.LunaPlugin.getByName("react")?.addDependant(luna.core.LunaPlugin.getByName("VolumeScroll"))});
var d=c(p());var x=c(S()),r=c(B()),u=c(L());
var a=await x.ReactiveStore.getPluginStorage("VolumeScroll",{changeBy:10,changeByShift:1});
var T=()=>{
    let[e,n]=u.default.useState(a.changeBy),[t,l]=u.default.useState(a.changeByShift);
    return u.default.createElement(r.LunaSettings,null,
        u.default.createElement(r.LunaNumberSetting,{title:"Change by",desc:"Percent to change volume by (default: 10)",value:e,min:0,max:100,onNumber:o=>n(a.changeBy=o)}),
        u.default.createElement(r.LunaNumberSetting,{title:"Change by shift",desc:"Percent to change volume by when SHIFT is held (default: 1)",value:t,onNumber:o=>l(a.changeByShift=o)})
    );
};

// 1. Force controllableVolume to be true so the volume button is NEVER greyed out
function ensureControllableVolume() {
    try {
        let store = d.redux?.store || x.reduxStore;
        let actions = d.redux?.actions;
        if (!store || !actions) return;
        let state = store.getState?.();
        let devices = state?.player?.availableDevices;
        if (Array.isArray(devices) && devices.some(dev => !dev.controllableVolume)) {
            actions["player/SET_AVAILABLE_DEVICES"]?.(devices.map(dev => ({ ...dev, controllableVolume: true })));
        }
    } catch (err) {
        console.warn("[VolumeScroll] Failed to ensure controllable volume:", err);
    }
}

// 2. Wheel event handler
function handleWheel(e) {
    if (!e.deltaY) return;
    let target = e.target;
    if (!target || typeof target.closest !== "function") return;
    
    // Check if the scroll happened over any volume control element
    let isVolumeArea = target.closest('div[class^="_sliderContainer"], [class*="_sliderContainer"], [data-test="volume"], [class*="_volume"], .horizontal-volume-slider');
    if (!isVolumeArea) return;
    
    e.preventDefault();
    e.stopPropagation();

    let store = d.redux?.store || x.reduxStore;
    let actions = d.redux?.actions;
    if (!store || !actions) return;
    
    let { playbackControls } = store.getState();
    let step = e.shiftKey ? a.changeByShift : a.changeBy;
    let delta = e.deltaY > 0 ? -step : step;
    let currentVol = playbackControls?.volume ?? 50;
    let newVol = Math.min(100, Math.max(0, currentVol + delta));
    
    actions["playbackControls/SET_VOLUME"]?.({ volume: newVol });
}

// 3. Setup event listeners and redux intercepts
var v = new Set();

// Delegated listener on document with { capture: true, passive: false }
// This completely solves the bug where re-rendering the player bar removes the listener
document.addEventListener("wheel", handleWheel, { capture: true, passive: false });
v.add(() => document.removeEventListener("wheel", handleWheel, { capture: true, passive: false }));

// Intercept devices to always ensure controllableVolume: true
d.redux.intercept("player/SET_AVAILABLE_DEVICES", v, e => {
    if (Array.isArray(e) && e.some(dev => !dev.controllableVolume)) {
        d.redux.actions["player/SET_AVAILABLE_DEVICES"]?.(e.map(dev => ({ ...dev, controllableVolume: true })));
        return true;
    }
});

// Intercept force volume to keep volume adjustable
d.redux.intercept("player/SET_FORCE_VOLUME", v, () => true);

// Check devices immediately and whenever active device changes
ensureControllableVolume();
d.redux.intercept("player/SET_ACTIVE_DEVICE", v, () => {
    setTimeout(ensureControllableVolume, 50);
});
d.redux.intercept("playbackControls/MEDIA_PRODUCT_TRANSITION", v, () => {
    ensureControllableVolume();
});

export { T as Settings, v as unloads };
//# sourceMappingURL=VolumeScroll.mjs.map
