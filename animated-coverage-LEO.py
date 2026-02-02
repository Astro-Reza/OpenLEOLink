import pygame
import numpy as np
import taichi as ti
import math

# Initialize Taichi
try:
    ti.init(arch=ti.gpu)
except:
    ti.init(arch=ti.vulkan)

# --- 1. CONFIGURATION ---
PLOT_WIDTH = 1100
PLOT_HEIGHT = 550
SIDEBAR_WIDTH = 300
WIN_WIDTH = PLOT_WIDTH + SIDEBAR_WIDTH
WIN_HEIGHT = PLOT_HEIGHT

MAX_POINTS = 3000
EARTH_IMG_PATH = "static/textures/2k_earth_daymap.jpg"
PI = 3.14159265359

# --- GPU FIELDS ---
points_3d = ti.Vector.field(3, dtype=ti.f32, shape=MAX_POINTS)
closest_site = ti.field(dtype=ti.int32, shape=(PLOT_WIDTH, PLOT_HEIGHT))
site_area = ti.field(dtype=ti.f32, shape=MAX_POINTS)
screen_pixels = ti.Vector.field(3, dtype=ti.f32, shape=(PLOT_WIDTH, PLOT_HEIGHT))
texture_map = ti.Vector.field(3, dtype=ti.f32, shape=(PLOT_WIDTH, PLOT_HEIGHT))
colormap_lut = ti.Vector.field(3, dtype=ti.f32, shape=512)
lat_weights = ti.field(dtype=ti.f32, shape=PLOT_HEIGHT)

# --- COLORMAP ---
@ti.kernel
def generate_turbo_colormap():
    for i in range(512):
        t = float(i) / 511.0
        r, g, b = 0.0, 0.0, 0.0
        if t < 0.15: 
            norm = t / 0.15
            r, g, b = 0.0, 0.0, 0.5 + 0.5 * norm
        elif t < 0.35: 
            norm = (t - 0.15) / 0.2
            r, g, b = 0.0, norm, 1.0
        elif t < 0.55: 
            norm = (t - 0.35) / 0.2
            r, g, b = 0.0, 1.0, 1.0 - norm
        elif t < 0.75: 
            norm = (t - 0.55) / 0.2
            r, g, b = norm, 1.0, 0.0
        elif t < 0.90: 
            norm = (t - 0.75) / 0.15
            r, g, b = 1.0, 1.0 - norm, 0.0
        else:
            norm = (t - 0.90) / 0.1
            r, g, b = 1.0 - 0.5 * norm, 0.0, 0.0
        colormap_lut[i] = ti.Vector([r, g, b])

# --- TAICHI KERNELS ---
@ti.kernel
def init_lat_weights():
    for y in range(PLOT_HEIGHT):
        v = float(y) / float(PLOT_HEIGHT)
        lat = (0.5 - v) * PI 
        lat_weights[y] = ti.cos(lat)

@ti.kernel
def load_texture(img: ti.types.ndarray(dtype=ti.f32, ndim=3)):
    for i, j in texture_map:
        texture_map[i, j] = ti.Vector([img[i, j, 0], img[i, j, 1], img[i, j, 2]])

@ti.kernel
def generate_orbits_3d(inclination_deg: float, total_sats: int, num_planes: int, time_offset: float):
    inc = inclination_deg * PI / 180.0
    sats_per_plane = total_sats // num_planes
    
    for i in range(total_sats):
        plane_idx = i % num_planes
        sat_idx_in_plane = i // num_planes
        
        raan = (plane_idx / float(num_planes)) * 2.0 * PI
        
        # We add 'time_offset' here to move the satellite along the anomaly
        anomaly = (sat_idx_in_plane / float(sats_per_plane)) * 2.0 * PI + (plane_idx * 0.5) + time_offset
        
        # Physics
        sin_lat = ti.sin(inc) * ti.sin(anomaly)
        lat = ti.asin(sin_lat)
        
        y_coord = ti.cos(inc) * ti.sin(anomaly)
        x_coord = ti.cos(anomaly)
        lon = ti.atan2(y_coord, x_coord) + raan
        
        # 3D Unit Vector
        p_x = ti.cos(lat) * ti.cos(lon)
        p_y = ti.cos(lat) * ti.sin(lon)
        p_z = ti.sin(lat)
        points_3d[i] = ti.Vector([p_x, p_y, p_z])

@ti.kernel
def compute_voronoi_spherical(total_pts: int):
    for x, y in closest_site:
        u = float(x) / float(PLOT_WIDTH)
        v = float(y) / float(PLOT_HEIGHT)
        lon = (u * 2.0 * PI) - PI
        lat = (0.5 - v) * PI
        
        px = ti.cos(lat) * ti.cos(lon)
        py = ti.cos(lat) * ti.sin(lon)
        pz = ti.sin(lat)
        pixel_vec = ti.Vector([px, py, pz])
        
        max_dot = -1.0
        closest_idx = -1
        
        for k in range(total_pts):
            dot = pixel_vec.dot(points_3d[k])
            if dot > max_dot:
                max_dot = dot
                closest_idx = k
        closest_site[x, y] = closest_idx

@ti.kernel
def compute_area_weighted(total_pts: int):
    for i in range(total_pts):
        site_area[i] = 0.0
    for x, y in closest_site:
        idx = closest_site[x, y]
        ti.atomic_add(site_area[idx], lat_weights[y])

@ti.kernel
def render_frame(min_area: float, max_area: float, num_pts: int, 
                 opacity: float, show_walls: int, show_dots: int):
    denom = max_area - min_area
    if denom == 0: denom = 1.0

    for x, y in screen_pixels:
        idx = closest_site[x, y]
        base_color = texture_map[x, y]
        
        area = site_area[idx]
        norm = (area - min_area) / denom
        norm = ti.max(0.0, ti.min(norm, 1.0))
        lut_idx = int(norm * 511)
        heatmap_color = colormap_lut[lut_idx]
        
        final_color = base_color * (1.0 - opacity) + heatmap_color * opacity

        if show_walls == 1:
            is_edge = False
            if x < PLOT_WIDTH - 1 and closest_site[x+1, y] != idx: is_edge = True
            if y < PLOT_HEIGHT - 1 and closest_site[x, y+1] != idx: is_edge = True
            if is_edge:
                final_color = ti.Vector([0.0, 0.0, 0.0])

        if show_dots == 1:
            u = float(x) / float(PLOT_WIDTH)
            v = float(y) / float(PLOT_HEIGHT)
            lon = (u * 2.0 * PI) - PI
            lat = (0.5 - v) * PI
            px = ti.cos(lat) * ti.cos(lon)
            py = ti.cos(lat) * ti.sin(lon)
            pz = ti.sin(lat)
            pix_vec = ti.Vector([px, py, pz])
            sat_vec = points_3d[idx]
            if pix_vec.dot(sat_vec) > 0.9997:
                 final_color = ti.Vector([1.0, 1.0, 1.0])

        screen_pixels[x, y] = final_color

# --- UI CLASSES ---
class SmoothingState:
    def __init__(self):
        self.smooth_min = 0.0
        self.smooth_max = 100.0

class Slider:
    def __init__(self, x, y, w, h, min_val, max_val, start_val, label):
        self.rect = pygame.Rect(x, y, w, h)
        self.min_val, self.max_val, self.val = min_val, max_val, start_val
        self.label, self.dragging = label, False
        rel = (self.val - self.min_val) / (self.max_val - self.min_val)
        self.handle_rect = pygame.Rect(x + rel * w - 10, y - 5, 20, h + 10)

    def draw(self, screen, font):
        label_surf = font.render(f"{self.label}", True, (200, 200, 200))
        screen.blit(label_surf, (self.rect.x, self.rect.y - 25))
        val_surf = font.render(f"{self.val:.2f}", True, (50, 200, 255))
        screen.blit(val_surf, (self.rect.x + 150, self.rect.y - 25))
        pygame.draw.rect(screen, (80, 80, 80), self.rect)
        pygame.draw.rect(screen, (50, 150, 255), self.handle_rect)

    def update(self, event):
        updated = False
        if event.type == pygame.MOUSEBUTTONDOWN:
            if self.handle_rect.collidepoint(event.pos) or self.rect.collidepoint(event.pos):
                self.dragging, updated = True, True
                self.move(event.pos[0])
        elif event.type == pygame.MOUSEBUTTONUP: self.dragging = False
        elif event.type == pygame.MOUSEMOTION and self.dragging:
            self.move(event.pos[0])
            updated = True
        return updated

    def move(self, mx):
        x = max(self.rect.left, min(mx, self.rect.right))
        self.handle_rect.centerx = x
        self.val = self.min_val + ((x - self.rect.left) / self.rect.width) * (self.max_val - self.min_val)

class Checkbox:
    def __init__(self, x, y, label, checked=True):
        self.rect = pygame.Rect(x, y, 20, 20)
        self.label = label
        self.checked = checked
    def draw(self, screen, font):
        color = (50, 150, 255) if self.checked else (80, 80, 80)
        pygame.draw.rect(screen, color, self.rect)
        pygame.draw.rect(screen, (200, 200, 200), self.rect, 2)
        text_surf = font.render(self.label, True, (220, 220, 220))
        screen.blit(text_surf, (self.rect.right + 10, self.rect.y))
        if self.checked:
            pygame.draw.line(screen, (255, 255, 255), (self.rect.left+4, self.rect.top+4), (self.rect.right-4, self.rect.bottom-4), 2)
            pygame.draw.line(screen, (255, 255, 255), (self.rect.left+4, self.rect.bottom-4), (self.rect.right-4, self.rect.top+4), 2)
    def update(self, event):
        if event.type == pygame.MOUSEBUTTONDOWN:
            if self.rect.collidepoint(event.pos):
                self.checked = not self.checked
                return True
        return False

# --- NEW: BUTTON CLASS ---
class Button:
    def __init__(self, x, y, w, h, text):
        self.rect = pygame.Rect(x, y, w, h)
        self.text = text
        self.is_hovered = False
        
    def draw(self, screen, font):
        color = (50, 200, 100) if self.is_hovered else (40, 160, 80)
        pygame.draw.rect(screen, color, self.rect, border_radius=5)
        pygame.draw.rect(screen, (200, 255, 200), self.rect, 2, border_radius=5)
        
        txt_surf = font.render(self.text, True, (255, 255, 255))
        txt_rect = txt_surf.get_rect(center=self.rect.center)
        screen.blit(txt_surf, txt_rect)
        
    def update(self, event):
        if event.type == pygame.MOUSEMOTION:
            self.is_hovered = self.rect.collidepoint(event.pos)
        if event.type == pygame.MOUSEBUTTONDOWN:
            if self.rect.collidepoint(event.pos):
                return True
        return False

# --- ORBIT LINE (CPU) ---
def draw_orbit_lines(screen, inclination, num_planes, color=(100, 200, 255)):
    inc_rad = math.radians(inclination)
    steps = 60
    for p in range(num_planes):
        raan = (p / num_planes) * 2 * math.pi
        points = []
        prev_x = -9999
        for i in range(steps + 1):
            anomaly = (i / steps) * 2 * math.pi
            sin_lat = math.sin(inc_rad) * math.sin(anomaly)
            lat = math.asin(sin_lat)
            y_c = math.cos(inc_rad) * math.sin(anomaly)
            x_c = math.cos(anomaly)
            lon = math.atan2(y_c, x_c) + raan
            lon = (lon + math.pi) % (2 * math.pi) - math.pi
            sx = (lon + math.pi) / (2 * math.pi) * PLOT_WIDTH
            sy = (0.5 - (lat / math.pi)) * PLOT_HEIGHT
            if abs(sx - prev_x) > PLOT_WIDTH / 2 and prev_x != -9999:
                 pygame.draw.lines(screen, color, False, points, 1)
                 points = []
            points.append((sx, sy))
            prev_x = sx
        if len(points) > 1:
            pygame.draw.lines(screen, color, False, points, 1)

def main():
    pygame.init()
    screen = pygame.display.set_mode((WIN_WIDTH, WIN_HEIGHT))
    pygame.display.set_caption("Live Constellation Simulator")
    font = pygame.font.SysFont("Arial", 16)
    title_font = pygame.font.SysFont("Arial", 22, bold=True)
    clock = pygame.time.Clock()
    
    generate_turbo_colormap()
    init_lat_weights()
    
    # Texture
    try:
        surf = pygame.image.load(EARTH_IMG_PATH)
        surf = pygame.transform.scale(surf, (PLOT_WIDTH, PLOT_HEIGHT))
    except:
        surf = pygame.Surface((PLOT_WIDTH, PLOT_HEIGHT))
        surf.fill((0, 10, 30))
        pygame.draw.rect(surf, (0, 60, 20), (100, 100, 200, 200))
    img_array = pygame.surfarray.array3d(surf).astype(np.float32) / 255.0
    load_texture(img_array)
    
    # UI - Using relative positions within sidebar
    ui_x_rel = 25  # Relative X position within sidebar
    ui_x = PLOT_WIDTH + ui_x_rel  # Absolute X for initial setup
    
    # Play Button (fixed at top, not scrollable)
    btn_play = Button(ui_x, 50, 220, 35, "PLAY SIMULATION")
    
    # Scrollable elements - positions relative to scroll area (starting at y=100)
    scroll_start_y = 100
    s_inc = Slider(ui_x, scroll_start_y + 10, 220, 8, 0.0, 90.0, 53.0, "Inclination (deg)")
    s_sats = Slider(ui_x, scroll_start_y + 70, 220, 8, 100, 2000, 600, "Satellites")
    s_planes = Slider(ui_x, scroll_start_y + 130, 220, 8, 1, 50, 12, "Orbital Planes")
    s_opacity = Slider(ui_x, scroll_start_y + 190, 220, 8, 0.0, 1.0, 0.7, "Heatmap Opacity")
    s_speed = Slider(ui_x, scroll_start_y + 250, 220, 8, 0.1, 5.0, 1.0, "Sim Speed")
    s_beam = Slider(ui_x, scroll_start_y + 310, 220, 8, 0.1, 3.0, 1.0, "Beam Size (Scale)")
    
    cb_walls = Checkbox(ui_x, scroll_start_y + 370, "Show Borders", True)
    cb_dots = Checkbox(ui_x, scroll_start_y + 405, "Show Dots", True)
    cb_lines = Checkbox(ui_x, scroll_start_y + 440, "Show Orbit Lines", True)
    
    ui_elements = [s_inc, s_sats, s_planes, s_opacity, s_speed, s_beam, cb_walls, cb_dots, cb_lines]
    
    # Scroll state
    scroll_offset = 0
    max_scroll = 200  # Max scroll amount (content extends beyond visible area)
    scroll_speed = 20
    
    state = SmoothingState()
    running = True
    is_playing = False
    time_val = 0.0 # Time Accumulator
    
    while running:
        screen.fill((30, 30, 30))
        pygame.draw.rect(screen, (40, 40, 45), (PLOT_WIDTH, 0, SIDEBAR_WIDTH, WIN_HEIGHT))
        pygame.draw.line(screen, (0, 0, 0), (PLOT_WIDTH, 0), (PLOT_WIDTH, WIN_HEIGHT), 2)
        
        for event in pygame.event.get():
            if event.type == pygame.QUIT: running = False
            
            # Handle scroll wheel in sidebar area
            if event.type == pygame.MOUSEWHEEL:
                mouse_x, mouse_y = pygame.mouse.get_pos()
                if mouse_x > PLOT_WIDTH:  # Mouse is in sidebar
                    scroll_offset -= event.y * scroll_speed
                    scroll_offset = max(0, min(scroll_offset, max_scroll))
            
            # Adjust event position for scrollable elements
            adjusted_event = event
            if hasattr(event, 'pos') and event.pos[0] > PLOT_WIDTH:
                # Create adjusted event with scroll offset
                adjusted_pos = (event.pos[0], event.pos[1] + scroll_offset)
                if event.type == pygame.MOUSEBUTTONDOWN:
                    adjusted_event = pygame.event.Event(pygame.MOUSEBUTTONDOWN, {'pos': adjusted_pos, 'button': event.button})
                elif event.type == pygame.MOUSEBUTTONUP:
                    adjusted_event = pygame.event.Event(pygame.MOUSEBUTTONUP, {'pos': adjusted_pos, 'button': event.button})
                elif event.type == pygame.MOUSEMOTION:
                    adjusted_event = pygame.event.Event(pygame.MOUSEMOTION, {'pos': adjusted_pos, 'rel': event.rel, 'buttons': event.buttons})
            
            for e in ui_elements: e.update(adjusted_event)
            if btn_play.update(event):  # Button uses original event (fixed position)
                is_playing = not is_playing
                btn_play.text = "PAUSE SIMULATION" if is_playing else "PLAY SIMULATION"
            
        # Time Logic
        if is_playing:
            # Add speed * delta
            time_val += 0.01 * s_speed.val
        
        # GPU Compute
        num_sats = int(s_sats.val)
        num_planes = int(s_planes.val)
        if num_planes < 1: num_planes = 1
        
        # Pass time_val to kernel
        generate_orbits_3d(s_inc.val, num_sats, num_planes, time_val)
        compute_voronoi_spherical(num_sats)
        compute_area_weighted(num_sats)
        
        # Smoothing
        raw_areas = site_area.to_numpy()[:num_sats]
        if len(raw_areas) > 0:
            t_min = np.percentile(raw_areas, 2)
            t_max = np.percentile(raw_areas, 98)
        else:
            t_min, t_max = 0, 1
        state.smooth_min += (t_min - state.smooth_min) * 0.1
        state.smooth_max += (t_max - state.smooth_max) * 0.1
        
        # Apply beam size scale to adjust color mapping range
        mid_area = (state.smooth_min + state.smooth_max) / 2.0
        half_range = (state.smooth_max - state.smooth_min) / 2.0
        scaled_half_range = half_range * s_beam.val
        render_min = mid_area - scaled_half_range
        render_max = mid_area + scaled_half_range
        
        # Render
        render_frame(render_min, render_max, num_sats, 
                     s_opacity.val, int(cb_walls.checked), int(cb_dots.checked))
                     
        img = screen_pixels.to_numpy().swapaxes(0, 1)
        img = (img * 255).astype(np.uint8)
        surf = pygame.transform.flip(pygame.transform.rotate(pygame.surfarray.make_surface(img), -90), True, False)
        screen.blit(surf, (0, 0))
        
        # Lines
        if cb_lines.checked:
            draw_orbit_lines(screen, s_inc.val, num_planes, color=(200, 200, 255))
        
        # UI - Fixed elements (not scrollable)
        title = title_font.render("Orbit Sim", True, (255, 255, 255))
        screen.blit(title, (PLOT_WIDTH + ui_x_rel, 15))
        
        btn_play.draw(screen, font)
        
        # Create clipping region for scrollable area
        scroll_area_rect = pygame.Rect(PLOT_WIDTH, scroll_start_y, SIDEBAR_WIDTH, WIN_HEIGHT - scroll_start_y - 80)
        
        # Draw scrollable UI elements with offset
        for e in ui_elements:
            # Calculate visible position
            orig_y = e.rect.y
            e.rect.y = orig_y - scroll_offset
            if hasattr(e, 'handle_rect'):
                orig_handle_y = e.handle_rect.y
                e.handle_rect.y = orig_handle_y - scroll_offset
            
            # Only draw if within visible area
            if e.rect.y + e.rect.height > scroll_start_y and e.rect.y < WIN_HEIGHT - 80:
                e.draw(screen, font)
            
            # Restore original position
            e.rect.y = orig_y
            if hasattr(e, 'handle_rect'):
                e.handle_rect.y = orig_handle_y
        
        # Scroll indicator
        if max_scroll > 0:
            scroll_bar_height = 60
            scroll_bar_y = scroll_start_y + (scroll_offset / max_scroll) * (scroll_area_rect.height - scroll_bar_height)
            pygame.draw.rect(screen, (60, 60, 70), (PLOT_WIDTH + SIDEBAR_WIDTH - 8, scroll_start_y, 6, scroll_area_rect.height))
            pygame.draw.rect(screen, (100, 150, 200), (PLOT_WIDTH + SIDEBAR_WIDTH - 8, scroll_bar_y, 6, scroll_bar_height), border_radius=3)
        
        # Fixed bottom elements - Legend and FPS
        legend_y = WIN_HEIGHT - 60
        for i in range(200):
            norm = i / 200.0
            r,g,b = 0,0,0
            if norm < 0.2: r,g,b = 0, 0, int(norm*5*255)
            elif norm < 0.4: r,g,b = 0, int((norm-0.2)*5*255), 255
            elif norm < 0.6: r,g,b = 0, 255, int((1-(norm-0.4)*5)*255)
            elif norm < 0.8: r,g,b = int((norm-0.6)*5*255), 255, 0
            else: r,g,b = 255, int((1-(norm-0.8)*5)*255), 0
            pygame.draw.line(screen, (r,g,b), (PLOT_WIDTH + ui_x_rel + i, legend_y), (PLOT_WIDTH + ui_x_rel + i, legend_y + 15))
        
        fps = font.render(f"FPS: {clock.get_fps():.1f}", True, (100, 255, 100))
        screen.blit(fps, (PLOT_WIDTH + ui_x_rel, WIN_HEIGHT - 30))
        
        pygame.display.flip()
        clock.tick(60)

    pygame.quit()

if __name__ == "__main__":
    main()