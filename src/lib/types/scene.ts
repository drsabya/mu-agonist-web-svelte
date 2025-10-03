// src/lib/types/scene.ts

// Roles for items (interaction semantics)
export type Role = 'none' | 'draggable' | 'target' | 'tappable';

// Animation types
export type AnimType = 'none' | 'move' | 'scale' | 'rotate' | 'opacity' | 'jitter' | 'pulse';

// Slider movement directions
export type MoveDir =
	| 'horizontal'
	| 'horizontalRev'
	| 'vertical'
	| 'verticalRev'
	| 'diag1'
	| 'diag1Rev'
	| 'diag2'
	| 'diag2Rev';

// One row from `scene_items` table
export interface SceneItem {
	id: string;
	scene_id: string;

	// Content
	kind: 'svg' | 'image';
	src: string;

	// Base transform
	cx_pct: number; // center X [0..1]
	cy_pct: number; // center Y [0..1]
	w_pct: number; // width as fraction of scene width [0..1]
	rot: number; // radians
	z_index: number;

	// Roles
	role: Role;
	correct_target_id?: string | null;
	tap_message?: string | null;
	final_cx_pct?: number | null;
	final_cy_pct?: number | null;

	// Animation
	anim_type: AnimType;
	anim_duration_ms?: number | null;
	anim_delay_ms?: number | null;
	anim_easing?: string | null;
	anim_move_cx_pct?: number | null;
	anim_move_cy_pct?: number | null;
	anim_scale_w_pct?: number | null;
	anim_rotate_by?: number | null;
	anim_opacity_to?: number | null;
	is_scene_trigger: boolean;

	// Slider behavior
	moveable: boolean;
	resizeable: boolean;
	move_dir?: MoveDir | null;
	scale_factor: number;

	// Audit
	created_at: string;
	updated_at: string;
}
