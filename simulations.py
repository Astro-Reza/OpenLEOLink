import pygame
import numpy as np
import matplotlib.pyplot as plt
import taichi as ti

# Initialize Taichi
try:
    ti.init(arch=ti.gpu) 
except:
    ti.init(arch=ti.vulkan)

# --- LAYOUT CONFIGURATION ---
WIN_WIDTH = 1000
WIN_HEIGHT = 700
SIDEBAR_WIDTH = 250
PLOT_WIDTH = WIN_WIDTH - SIDEBAR_WIDTH
PLOT_HEIGHT = WIN_HEIGHT

MAX_POINTS = 2000 

# --- GPU FIELDS ---
points = ti.Vector.field(2, dtype=ti.f32, shape=MAX_POINTS * 5)
closest_site = ti.field(dtype=ti.int32, shape=(PLOT_WIDTH, PLOT_HEIGHT))
site_area = ti.field(dtype=ti.int32, shape=MAX_POINTS * 5)
screen_pixels = ti.Vector.field(3, dtype=ti.f32, shape=(PLOT_WIDTH, PLOT_HEIGHT))
colormap_lut = ti.Vector.field(3, dtype=ti.f32, shape=256)

# --- COLORMAP SETUP ---
def load_colormap():
    cmap = plt.get_cmap('RdYlGn_r')
    colors = cmap(np.linspace(0, 1, 256))[:, :3]
    colormap_lut.from_numpy(colors.astype(np.float32))

load_colormap()

# --- TAICHI KERNELS ---

@ti.kernel
def generate_lissajous(res_factor: float, num: int, width_fov: float, height_fov: float):
    min_lobes, max_lobes = 5.0, 15.0
    k = min_lobes + (max_lobes - min_lobes) * res_factor
    fx, fy = k, k + 1.0
    
    scale_x = PLOT_WIDTH / width_fov
    scale_y = PLOT_HEIGHT / height_fov
    center_x = PLOT_WIDTH / 2.0
    center_y = PLOT_HEIGHT / 2.0

    for i in range(num):
        t = i / float(num)
        # Lissajous Math
        raw_x = (width_fov / 2.0) * ti.cos(2 * 3.14159 * fx * t)
        raw_y = (height_fov / 2.0) * ti.cos(2 * 3.14159 * fy * t + 1.5708)
        
        # Center Point
        points[i] = ti.Vector([raw_x * scale_x + center_x, raw_y * scale_y + center_y])
        
        # Reflections (Left, Right, Down, Up)
        points[num + i]   = ti.Vector([(-width_fov - raw_x) * scale_x + center_x, raw_y * scale_y + center_y])
        points[2*num + i] = ti.Vector([(width_fov - raw_x) * scale_x + center_x, raw_y * scale_y + center_y])
        points[3*num + i] = ti.Vector([raw_x * scale_x + center_x, (-height_fov - raw_y) * scale_y + center_y])
        points[4*num + i] = ti.Vector([raw_x * scale_x + center_x, (height_fov - raw_y) * scale_y + center_y])

@ti.kernel
def compute_voronoi(total_pts: int):
    for x, y in closest_site:
        min_dist = 1e9
        closest_idx = -1
        pixel_pos = ti.Vector([float(x), float(y)])
        
        for k in range(total_pts):
            dist = (pixel_pos - points[k]).norm_sqr()
            if dist < min_dist:
                min_dist = dist
                closest_idx = k
        closest_site[x, y] = closest_idx

@ti.kernel
def compute_area():
    for i in site_area:
        site_area[i] = 0
    for x, y in closest_site:
        ti.atomic_add(site_area[closest_site[x, y]], 1)

@ti.kernel
def render_frame(min_area: float, max_area: float, num_pts: int, show_color: int, show_walls: int, show_dots: int):
    denom = max_area - min_area
    if denom == 0: denom = 1.0

    for x, y in screen_pixels:
        idx = closest_site[x, y]
        
        # --- 1. Base Color ---
        if show_color == 1:
            area = float(site_area[idx])
            norm = (area - min_area) / denom
            norm = ti.max(0.0, ti.min(norm, 1.0))
            lut_idx = int(norm * 255)
            screen_pixels[x, y] = colormap_lut[lut_idx]
        else:
            # Dark grey background if color is off
            screen_pixels[x, y] = ti.Vector([0.15, 0.15, 0.15])

        # --- 2. Walls ---
        if show_walls == 1:
            is_edge = False
            if x < PLOT_WIDTH - 1 and closest_site[x+1, y] != idx: is_edge = True
            if y < PLOT_HEIGHT - 1 and closest_site[x, y+1] != idx: is_edge = True
            
            if is_edge:
                if show_color == 1:
                    # Black edges on colored map
                    screen_pixels[x, y] = ti.Vector([0.0, 0.0, 0.0]) 
                else:
                    # White edges on dark map (Wireframe look)
                    screen_pixels[x, y] = ti.Vector([0.8, 0.8, 0.8])

        # --- 3. Dots (FIXED) ---
        if show_dots == 1:
            p = points[idx]
            # Simple distance check for dot
            if (ti.Vector([float(x), float(y)]) - p).norm_sqr() < 9.0: # Radius squared
                if show_color == 1:
                    screen_pixels[x, y] = ti.Vector([0.0, 0.0, 0.0])
                else:
                    screen_pixels[x, y] = ti.Vector([1.0, 1.0, 1.0])

# --- STATE MANAGER ---
class SmoothingState:
    def __init__(self):
        self.smooth_min = 0.0
        self.smooth_max = 1000.0

# --- UI CLASSES ---
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
        # Draw box
        color = (50, 150, 255) if self.checked else (80, 80, 80)
        pygame.draw.rect(screen, color, self.rect)
        pygame.draw.rect(screen, (200, 200, 200), self.rect, 2) # Border
        
        # Draw Label
        text_surf = font.render(self.label, True, (220, 220, 220))
        screen.blit(text_surf, (self.rect.right + 10, self.rect.y))
        
        # Checkmark (X)
        if self.checked:
            pygame.draw.line(screen, (255, 255, 255), (self.rect.left+4, self.rect.top+4), (self.rect.right-4, self.rect.bottom-4), 2)
            pygame.draw.line(screen, (255, 255, 255), (self.rect.left+4, self.rect.bottom-4), (self.rect.right-4, self.rect.top+4), 2)

    def update(self, event):
        if event.type == pygame.MOUSEBUTTONDOWN:
            if self.rect.collidepoint(event.pos):
                self.checked = not self.checked
                return True
        return False

# --- MAIN ---
def main():
    pygame.init()
    screen = pygame.display.set_mode((WIN_WIDTH, WIN_HEIGHT))
    pygame.display.set_caption("Voronoi Visualization Studio")
    font = pygame.font.SysFont("Arial", 16)
    title_font = pygame.font.SysFont("Arial", 22, bold=True)
    clock = pygame.time.Clock()
    
    # --- UI LAYOUT ---
    ui_x = PLOT_WIDTH + 25
    
    # Sliders
    slider_res = Slider(ui_x, 80, 200, 8, 0.0, 1.0, 0.5, "Res Factor")
    slider_samples = Slider(ui_x, 150, 200, 8, 100, 1000, 400, "Point Count")
    
    # Checkboxes
    cb_color = Checkbox(ui_x, 220, "Show Color (Heatmap)", True)
    cb_walls = Checkbox(ui_x, 260, "Show Walls", True)
    cb_dots  = Checkbox(ui_x, 300, "Show Dots", False)
    cb_path  = Checkbox(ui_x, 340, "Show Lissajous Path", False)
    
    ui_elements = [slider_res, slider_samples, cb_color, cb_walls, cb_dots, cb_path]
    state = SmoothingState()
    running = True
    
    while running:
        # Background
        screen.fill((30, 30, 30))
        
        # Draw Sidebar Background
        pygame.draw.rect(screen, (40, 40, 45), (PLOT_WIDTH, 0, SIDEBAR_WIDTH, WIN_HEIGHT))
        pygame.draw.line(screen, (0, 0, 0), (PLOT_WIDTH, 0), (PLOT_WIDTH, WIN_HEIGHT), 2)

        for event in pygame.event.get():
            if event.type == pygame.QUIT: running = False
            for elem in ui_elements: elem.update(event)

        # 1. GPU Calculations
        num_pts = int(slider_samples.val)
        fov_w = 20.0
        fov_h = 20.0 * (PLOT_HEIGHT / PLOT_WIDTH) 
        
        generate_lissajous(slider_res.val, num_pts, fov_w, fov_h)
        compute_voronoi(num_pts * 5)
        compute_area()
        
        # 2. Smoothing
        raw_areas = site_area.to_numpy()[:num_pts]
        if len(raw_areas) > 0:
            t_min = np.percentile(raw_areas, 5)
            t_max = np.percentile(raw_areas, 95)
        else:
            t_min, t_max = 0, 100

        state.smooth_min += (t_min - state.smooth_min) * 0.1
        state.smooth_max += (t_max - state.smooth_max) * 0.1
        
        # 3. Render GPU Image
        render_frame(state.smooth_min, state.smooth_max, num_pts, 
                     int(cb_color.checked), int(cb_walls.checked), int(cb_dots.checked))
        
        img = screen_pixels.to_numpy().swapaxes(0, 1)
        img = (img * 255).astype(np.uint8)
        surf = pygame.transform.flip(pygame.transform.rotate(pygame.surfarray.make_surface(img), -90), True, False)
        
        # 4. Draw Image
        screen.blit(surf, (0, 0))
        
        # 5. Draw Lissajous Path (CPU Overlay)
        if cb_path.checked:
            try:
                # 1. Get raw float data from GPU
                raw_pts = points.to_numpy()[:num_pts]
                
                # 2. Safety Check: Ensure we have enough points
                if len(raw_pts) > 1:
                    path_int = raw_pts.astype(np.int32)
                    
                    # 4. Draw
                    pygame.draw.lines(screen, (255, 255, 255), False, path_int, 2)
            except Exception as e:
                print(f"Error drawing path: {e}")
        
        # 6. Draw UI
        title = title_font.render("Settings", True, (255, 255, 255))
        screen.blit(title, (ui_x, 20))
        
        for elem in ui_elements: elem.draw(screen, font)
        
        fps_surf = font.render(f"FPS: {clock.get_fps():.1f}", True, (100, 255, 100))
        screen.blit(fps_surf, (ui_x, WIN_HEIGHT - 40))
        
        pygame.display.flip()
        clock.tick(60)

    pygame.quit()

if __name__ == "__main__":
    main()