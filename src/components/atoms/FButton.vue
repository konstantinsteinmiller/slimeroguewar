<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  label?: string
  type?: 'primary' | 'secondary'
  variant?: 'default' | 'brawl'
  isDisabled?: boolean
  colorFrom?: string
  colorTo?: string
  shadowColor?: string
  /** Sizing token. We tune via clamp() ranges (vw/rem) so every size
   *  works on phone portrait, phone landscape, tablet and desktop
   *  without the old scale-60/80/110/120 kludges. */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  attention?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  label: 'NO LABEL DEFINED!',
  type: 'primary',
  variant: 'default',
  attention: false
})

defineEmits(['click'])

// Map the theme colors based on the type prop
const theme = computed(() => {
  if (props.type === 'secondary') {
    return {
      from: props.colorFrom ?? '#50aaff', // Light Blue
      to: props.colorTo ?? '#2266ff',     // Darker Blue
      shadow: props.shadowColor ?? '#102e7a'
    }
  }
  // Default Primary (Brawl Stars Yellow)
  return {
    from: props.colorFrom ?? '#ffcd00',
    to: props.colorTo ?? '#f7a000',
    shadow: props.shadowColor ?? '#1a2b4b'
  }
})

const sizeClass = computed(() => `f-button--${props.size ?? 'md'}`)
const variantClass = computed(() => `f-button--${props.variant}`)

const containerClasses = computed(() => ({
  'f-button-container': true,
  [variantClass.value]: true,
  [sizeClass.value]: true,
  'attention-bounce': props.attention,
  'is-disabled': props.isDisabled
}))
</script>

<template lang="pug">
  div(:class="containerClasses")
    button(
      type="button"
      @click="$emit('click')"
      :class="[\
        variant === 'brawl' \
          ? 'inline-block skew-x-[-12deg] active:scale-95' \
          : 'w-full inline-block active:scale-x-[95%] active:scale-y-[90%] hover:scale-[103%]',\
        'group relative cursor-pointer select-none transition-all duration-75 hover:brightness-110 touch-manipulation'\
      ]"
    )
      //- The "Bottom Shadow" / 3D Depth
      span.f-button-shadow(
        :style="{ backgroundColor: theme.shadow }"
        :class="[\
          variant === 'brawl' \
            ? 'translate-y-[3px] w-full h-full rounded-xl' \
            : 'absolute inset-0 translate-y-[3px] rounded-2xl'\
        ]"
        class="absolute inset-0"
      )

      //- The Main Button Body — sizing now driven by CSS clamp() in <style>,
      //- not Tailwind scale-XX hacks. Each size token defines its own
      //- min-width / padding / font-size so the button never collapses
      //- to 0 width and never overflows its container.
      span.f-button-body(
        :style="{ backgroundImage: `linear-gradient(to bottom, ${theme.from}, ${theme.to})` }"
        :class="[\
          variant === 'brawl' \
            ? 'border-b-[3px] border-black/20 rounded-lg' \
            : 'rounded-2xl border-[2px] border-[#0f1a30]'\
        ]"
        class="relative block"
      )
        //- Inner Top Shine
        span(
          :class="[\
            variant === 'brawl' \
              ? 'h-[50%] bg-white/30 rounded-t-lg' \
              : 'h-1/2 rounded-t-xl bg-white/25'\
          ]"
          class="absolute inset-x-0 top-0"
        )

        //- Button Text / Content
        span(:class="{ 'skew-x-[12deg]': variant === 'brawl' }" class="relative block")
          span.text(
            :class="[\
              variant === 'brawl' \
                ? 'tracking-tighter italic' \
                : 'tracking-wide'\
            ]"
            class="relative block text-white uppercase font-black"
          )
            slot Button
</template>

<style scoped lang="sass">
button
  -webkit-tap-highlight-color: transparent

.text
  // Thick gaming-style text outline
  text-shadow: 3px 3px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000

// ─── Responsive sizing tokens ─────────────────────────────────────────────
// Each size uses clamp() to scale fluidly between phone-portrait,
// phone-landscape and desktop. Min/max guards make sure the button is
// never narrower than a touch target (44px) and never wider than
// makes sense for its slot.

.f-button-container
  width: 100%
  display: flex
  justify-content: center

  &.f-button--brawl
    display: flex
  // Brawl buttons re-skew the body inward — adjust min-width up
  // because the skew compresses the visual width.

  // ── Sizes ──
  .f-button-body
    min-width: clamp(80px, 18vw, 140px)
    padding: clamp(0.45rem, 1.6vw, 0.8rem) clamp(0.9rem, 2.4vw, 1.5rem)
  .text
    font-size: clamp(0.85rem, 2.4vw, 1.15rem)

  &.f-button--sm
    .f-button-body
      min-width: clamp(70px, 14vw, 110px)
      padding: clamp(0.32rem, 1.1vw, 0.55rem) clamp(0.7rem, 1.8vw, 1.1rem)
    .text
      font-size: clamp(0.75rem, 1.9vw, 0.95rem)

  &.f-button--lg
    .f-button-body
      min-width: clamp(110px, 24vw, 200px)
      padding: clamp(0.6rem, 2vw, 1rem) clamp(1.2rem, 3vw, 2rem)
    .text
      font-size: clamp(1rem, 3vw, 1.4rem)

  &.f-button--xl
    .f-button-body
      min-width: clamp(140px, 30vw, 260px)
      padding: clamp(0.75rem, 2.4vw, 1.2rem) clamp(1.4rem, 3.4vw, 2.4rem)
    .text
      font-size: clamp(1.15rem, 3.5vw, 1.6rem)

  // Brawl variant tweaks: italics + slight extra padding so the skewed
  // edge doesn't crowd the text.
  &.f-button--brawl
    .f-button-body
      padding-left: clamp(1.4rem, 3.6vw, 2.4rem)
      padding-right: clamp(1.4rem, 3.6vw, 2.4rem)
      border-radius: 0.5rem
    &.f-button--md .text
      font-size: clamp(0.95rem, 2.6vw, 1.25rem)
    &.f-button--lg .text
      font-size: clamp(1.1rem, 3vw, 1.55rem)

  // Disabled state preserved.
  &.is-disabled
    opacity: 0.5
    filter: grayscale(1)
    pointer-events: none

.attention-bounce
  animation: bounce 0.6s infinite alternate

@keyframes bounce
  from
    transform: translateY(0)
  to
    transform: translateY(-5px)
</style>
