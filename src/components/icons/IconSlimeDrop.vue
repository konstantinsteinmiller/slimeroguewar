<script setup lang="ts">
import { ref } from 'vue'

defineOptions({ inheritAttrs: true })

/**
 * Tracks whether the bundled artwork at
 * `/public/images/models/slime-drop_*.webp` failed to load. Until that
 * happens we render the bitmap; on any error we fall back to the
 * procedural SVG below so the icon never disappears entirely. The
 * sprite is in the splash-blocking preload tier (see `useAssets.ts`),
 * so the @error path effectively only fires when the file is missing
 * (e.g. native bundle without the asset shipped) rather than on a
 * slow-cold-fetch first frame.
 */
const imgFailed = ref(false)
const SPRITE_SRC = '/images/models/slime-drop_256x256.webp'
</script>

<template lang="pug">
  //- Sprite path — preferred when the asset loads.
  img.icon-slime-drop(
    v-if="!imgFailed"
    :src="SPRITE_SRC"
    @error="imgFailed = true"
    draggable="false"
    alt=""
    class="object-contain pointer-events-none select-none"
  )
  //- Procedural SVG fallback — same drop silhouette + body gradient as
  //- the bitmap. Kept around so the icon still reads when the file is
  //- missing or the platform strips assets.
  svg.icon-slime-drop(
    v-else
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
  )
    defs
      radialGradient(id="slime-drop-body" cx="0.4" cy="0.35" r="0.7")
        stop(offset="0%" stop-color="#bdf264")
        stop(offset="55%" stop-color="#65b30a")
        stop(offset="100%" stop-color="#3d6f00")
    path(
      d="M12 2 C 6 8 3 12 3 16 a 9 9 0 0 0 18 0 c 0 -4 -3 -8 -9 -14 z"
      fill="#0d2200"
      stroke="#0d2200"
      stroke-width="1.2"
      stroke-linejoin="round"
    )
    path(
      d="M12 3.4 C 6.8 8.7 4.2 12.3 4.2 15.9 a 7.8 7.8 0 0 0 15.6 0 c 0 -3.6 -2.6 -7.2 -7.8 -12.5 z"
      fill="url(#slime-drop-body)"
    )
    ellipse(
      cx="9"
      cy="9.5"
      rx="2.2"
      ry="3.2"
      fill="#ffffff"
      fill-opacity="0.55"
      transform="rotate(-22 9 9.5)"
    )
    circle(cx="14.6" cy="13.6" r="0.7" fill="#ffffff" fill-opacity="0.6")
</template>
