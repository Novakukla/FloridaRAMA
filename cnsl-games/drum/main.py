"""
Asteroid Shooter Game with Touchless Button Input
-------------------------------------------------

This module implements a simplified asteroid shooter game using Pygame.  The
play field is divided into eight lanes.  Asteroids spawn at the top of these
lanes and fall towards the bottom of the screen.  The player interacts with
the game either via physical touchless sensors (e.g. infrared proximity
sensors connected through an Arduino) or by using the keyboard.  Each lane
corresponds to one of eight buttons.  Pressing a button fires a laser up
that lane.  If the laser collides with an asteroid then the asteroid is
destroyed and the player’s score increases.  Each button has its own
cool‑down time; pressing a button while its cool‑down is active does
nothing and prints a message in the UI.

In addition to the eight firing buttons, there are three power‑up buttons
located at the bottom of the console.  Their functions are:

1. **Reset Cooldowns** – Instantly reset the cool‑down timers of all eight
   firing buttons.
2. **Clear Screen** – Remove all asteroids currently on the screen.
3. **Heal** – Restore some of the player's health (up to a maximum).

Each power‑up has its own cool‑down period.  Attempting to use a power‑up
while it is cooling down will display an “ability on cooldown” message in
the UI.

The right side of the screen is reserved for a status panel.  This panel
shows the player’s current health, score, and the remaining cool‑down time
for each power‑up.  It also displays transient messages, such as when an
ability is used while on cool‑down.

To adapt this script for a physical installation, hook up the Arduino
running the touchless button firmware to a Raspberry Pi via USB.  A
companion Python script can read the serial output from the Arduino,
translate button trigger messages into lane and power‑up events, and feed
them into this game loop.  Until then, the game defaults to keyboard
controls for testing on a laptop: keys 1–8 correspond to lanes 1–8, and
keys Q, W and E correspond to the three power‑ups.

Author: Fairgrounds Inc., adapted for Pygame by ChatGPT (2025)
"""

import random
import sys
import time
from typing import List, Tuple

import pygame


# Type aliases for clarity
Vec2 = Tuple[float, float]


class Asteroid:
    """Represents a single asteroid falling down a lane."""

    def __init__(self, lane: int, x: float, y: float, radius: float, speed: float) -> None:
        self.lane = lane
        self.x = x
        self.y = y
        self.radius = radius
        self.speed = speed

    def update(self, dt: float) -> None:
        """Update the asteroid's position.

        Parameters
        ----------
        dt: float
            Time step in seconds since the last update.
        """
        self.y += self.speed * dt

    def draw(self, surface: pygame.Surface, color: Tuple[int, int, int]) -> None:
        """Draw the asteroid on the given surface."""
        pygame.draw.circle(surface, color, (int(self.x), int(self.y)), int(self.radius))


class Laser:
    """Represents a laser fired up a lane."""

    def __init__(self, lane: int, x: float, y: float, width: float, height: float, speed: float) -> None:
        self.lane = lane
        self.x = x
        self.y = y
        self.width = width
        self.height = height
        self.speed = speed
        # A rectangle is used for collision detection
        self.rect = pygame.Rect(self.x - self.width / 2, self.y, self.width, self.height)

    def update(self, dt: float) -> None:
        """Move the laser up the screen."""
        self.y -= self.speed * dt
        self.rect.y = int(self.y)

    def draw(self, surface: pygame.Surface, color: Tuple[int, int, int]) -> None:
        """Draw the laser as a rectangle."""
        pygame.draw.rect(surface, color, self.rect)


class Game:
    """Encapsulates the state and behaviour of the asteroid shooter game."""

    # Layout constants
    SCREEN_WIDTH = 1024
    SCREEN_HEIGHT = 768
    UI_WIDTH_RATIO = 0.25  # percentage of screen width used for the UI panel
    LANE_COUNT = 8
    MAX_HEALTH = 10

    # Gameplay constants
    BUTTON_COOLDOWN = 0.6  # seconds between shots on the same lane
    POWERUP_COOLDOWNS = [12.0, 10.0, 15.0]  # reset cooldowns, clear screen, heal
    LASER_SPEED = 800.0  # pixels per second
    LASER_HEIGHT = 30.0
    LASER_WIDTH = 10.0
    ASTEROID_SPEED_RANGE = (80.0, 140.0)  # pixels per second
    ASTEROID_RADIUS_RANGE = (15.0, 30.0)
    ASTEROID_SPAWN_INTERVAL = 0.9
    HEAL_AMOUNT = 3
    MESSAGE_DURATION = 2.0  # seconds

    # Colour palette
    BACKGROUND_COLOR = (20, 20, 30)
    LANE_COLOR = (40, 40, 60)
    ASTEROID_COLOR = (180, 180, 200)
    LASER_COLOR = (200, 50, 50)
    TEXT_COLOR = (240, 240, 240)
    BUTTON_READY_COLOR = (50, 100, 200)
    BUTTON_COOLDOWN_COLOR = (100, 50, 50)
    POWERUP_READY_COLOR = (50, 200, 100)
    POWERUP_COOLDOWN_COLOR = (100, 50, 50)

    # Key mappings: lanes 0–7 map to keys 1–8, power‑ups to Q/W/E
    LANE_KEYS = [
        pygame.K_1,
        pygame.K_2,
        pygame.K_3,
        pygame.K_4,
        pygame.K_5,
        pygame.K_6,
        pygame.K_7,
        pygame.K_8,
    ]
    POWER_KEYS = [pygame.K_q, pygame.K_w, pygame.K_e]

    def __init__(self, full_screen: bool = False) -> None:
        pygame.init()
        flags = pygame.FULLSCREEN if full_screen else 0
        self.screen = pygame.display.set_mode(
            (self.SCREEN_WIDTH, self.SCREEN_HEIGHT), flags
        )
        pygame.display.set_caption("Touchless Asteroid Shooter")
        self.clock = pygame.time.Clock()
        self.font_small = pygame.font.Font(None, 28)
        self.font_medium = pygame.font.Font(None, 36)
        self.font_large = pygame.font.Font(None, 48)

        # Compute UI layout
        self.ui_width = int(self.SCREEN_WIDTH * self.UI_WIDTH_RATIO)
        self.play_width = self.SCREEN_WIDTH - self.ui_width
        self.lane_width = self.play_width / self.LANE_COUNT

        # Game state
        self.running = True
        self.health = self.MAX_HEALTH
        self.score = 0

        self.button_cooldowns: List[float] = [0.0 for _ in range(self.LANE_COUNT)]
        self.powerup_cooldowns: List[float] = [0.0, 0.0, 0.0]
        self.asteroids: List[Asteroid] = []
        self.lasers: List[Laser] = []
        self.messages: List[Tuple[str, float]] = []
        self.last_spawn_time = time.time()

    def reset(self) -> None:
        """Reset the game state."""
        self.health = self.MAX_HEALTH
        self.score = 0
        self.button_cooldowns = [0.0 for _ in range(self.LANE_COUNT)]
        self.powerup_cooldowns = [0.0, 0.0, 0.0]
        self.asteroids.clear()
        self.lasers.clear()
        self.messages.clear()
        self.last_spawn_time = time.time()

    # -------------------------------------------------------------------------
    # Message handling
    #
    def add_message(self, text: str) -> None:
        """Add a transient message to the UI panel.

        Messages are displayed for a short duration and then expire automatically.
        """
        expiry = time.time() + self.MESSAGE_DURATION
        self.messages.append((text, expiry))

    def update_messages(self) -> None:
        """Remove expired messages from the message list."""
        now = time.time()
        self.messages = [(t, exp) for (t, exp) in self.messages if exp > now]

    # -------------------------------------------------------------------------
    # Input handling
    #
    def handle_keydown(self, key: int) -> None:
        """Handle keyboard input for testing on a laptop.

        In a production installation with touchless buttons, this method can be
        triggered from external input events instead of directly responding to
        keyboard events.
        """
        # Fire lasers for lane keys
        if key in self.LANE_KEYS:
            lane = self.LANE_KEYS.index(key)
            self.shoot(lane)
            return

        # Activate power‑ups
        if key in self.POWER_KEYS:
            index = self.POWER_KEYS.index(key)
            self.activate_powerup(index)
            return

    def shoot(self, lane: int) -> None:
        """Fire a laser up the specified lane if the cool‑down has expired."""
        if self.button_cooldowns[lane] > 0.0:
            self.add_message(f"Lane {lane + 1} shot is on cooldown")
            return
        # Determine x coordinate of the laser (centre of lane)
        x = (self.lane_width * lane) + (self.lane_width / 2)
        y = self.SCREEN_HEIGHT - 10.0  # spawn just above bottom of play area
        laser = Laser(lane, x, y, self.LASER_WIDTH, self.LASER_HEIGHT, self.LASER_SPEED)
        self.lasers.append(laser)
        self.button_cooldowns[lane] = self.BUTTON_COOLDOWN

    def activate_powerup(self, index: int) -> None:
        """Trigger one of the three power‑ups if its cool‑down has expired."""
        if self.powerup_cooldowns[index] > 0.0:
            self.add_message("Ability on cooldown")
            return
        if index == 0:
            # Reset all button cool‑downs
            self.button_cooldowns = [0.0 for _ in range(self.LANE_COUNT)]
            self.add_message("Firing cool‑downs reset")
        elif index == 1:
            # Clear all asteroids
            count = len(self.asteroids)
            self.asteroids.clear()
            self.add_message(f"Cleared {count} asteroids")
        elif index == 2:
            # Heal the player
            if self.health < self.MAX_HEALTH:
                prev = self.health
                self.health = min(self.MAX_HEALTH, self.health + self.HEAL_AMOUNT)
                gained = self.health - prev
                self.add_message(f"Healed {gained} health")
            else:
                self.add_message("Health already full")
        # Set the cool‑down
        self.powerup_cooldowns[index] = self.POWERUP_COOLDOWNS[index]

    # -------------------------------------------------------------------------
    # Game update functions
    #
    def spawn_asteroid(self) -> None:
        """Spawn a new asteroid in a random lane."""
        lane = random.randrange(self.LANE_COUNT)
        radius = random.uniform(*self.ASTEROID_RADIUS_RANGE)
        x = (self.lane_width * lane) + (self.lane_width / 2)
        y = -radius  # start above the visible play area
        speed = random.uniform(*self.ASTEROID_SPEED_RANGE)
        self.asteroids.append(Asteroid(lane, x, y, radius, speed))

    def update_entities(self, dt: float) -> None:
        """Update all movable entities: asteroids and lasers."""
        # Update asteroids
        for asteroid in self.asteroids[:]:
            asteroid.update(dt)
            # Remove asteroids that have moved off the bottom of the play area
            if asteroid.y - asteroid.radius > self.SCREEN_HEIGHT:
                self.asteroids.remove(asteroid)
                self.health = max(0, self.health - 1)
                if self.health == 0:
                    self.add_message("Game over – reset to play again")

        # Update lasers
        for laser in self.lasers[:]:
            laser.update(dt)
            # Remove lasers that have moved off the top
            if laser.y + laser.height < 0:
                self.lasers.remove(laser)

        # Collision detection: remove lasers and asteroids if they collide
        for laser in self.lasers[:]:
            for asteroid in self.asteroids[:]:
                if laser.lane == asteroid.lane:
                    # Simple vertical collision detection: check if the laser's y intersects the asteroid
                    if asteroid.y + asteroid.radius >= laser.y and asteroid.y - asteroid.radius <= laser.y + laser.height:
                        # Destroy the asteroid and remove the laser
                        if asteroid in self.asteroids:
                            self.asteroids.remove(asteroid)
                            self.score += 1
                        if laser in self.lasers:
                            self.lasers.remove(laser)
                        break

    def update_cooldowns(self, dt: float) -> None:
        """Reduce the cool‑down timers for firing and power‑ups."""
        for i in range(self.LANE_COUNT):
            if self.button_cooldowns[i] > 0.0:
                self.button_cooldowns[i] = max(0.0, self.button_cooldowns[i] - dt)
        for i in range(3):
            if self.powerup_cooldowns[i] > 0.0:
                self.powerup_cooldowns[i] = max(0.0, self.powerup_cooldowns[i] - dt)

    def update(self, dt: float) -> None:
        """Update the entire game state for a frame."""
        # Spawn asteroids periodically
        now = time.time()
        if now - self.last_spawn_time > self.ASTEROID_SPAWN_INTERVAL:
            self.last_spawn_time = now
            self.spawn_asteroid()

        # Update game entities and cool‑downs
        self.update_entities(dt)
        self.update_cooldowns(dt)
        self.update_messages()

    # -------------------------------------------------------------------------
    # Drawing functions
    #
    def draw_lanes(self) -> None:
        """Draw the eight lanes on the left side of the screen."""
        for i in range(self.LANE_COUNT):
            x = i * self.lane_width
            rect = pygame.Rect(int(x), 0, int(self.lane_width), self.SCREEN_HEIGHT)
            pygame.draw.rect(self.screen, self.LANE_COLOR, rect, 1)

            # Visual indicator for button cool‑down: draw a bar near the bottom of each lane
            bar_height = 8
            bar_width = int(self.lane_width * 0.8)
            bar_x = x + (self.lane_width - bar_width) / 2
            bar_y = self.SCREEN_HEIGHT - 20
            # Fill ratio based on remaining cool‑down time
            ratio = self.button_cooldowns[i] / self.BUTTON_COOLDOWN if self.BUTTON_COOLDOWN > 0 else 0
            fill_width = int(bar_width * ratio)
            # Draw background of the bar
            pygame.draw.rect(self.screen, (60, 60, 80), (bar_x, bar_y, bar_width, bar_height))
            # Draw the cool‑down fill
            pygame.draw.rect(self.screen, (200, 60, 60), (bar_x, bar_y, fill_width, bar_height))

    def draw_entities(self) -> None:
        """Draw asteroids and lasers."""
        # Draw asteroids
        for asteroid in self.asteroids:
            asteroid.draw(self.screen, self.ASTEROID_COLOR)
        # Draw lasers
        for laser in self.lasers:
            laser.draw(self.screen, self.LASER_COLOR)

    def draw_ui_panel(self) -> None:
        """Draw the right side UI panel displaying health, score, and power‑ups."""
        # Panel background
        ui_x = self.play_width
        panel_rect = pygame.Rect(ui_x, 0, self.ui_width, self.SCREEN_HEIGHT)
        pygame.draw.rect(self.screen, (30, 30, 50), panel_rect)

        # Health bar
        health_bar_width = int(self.ui_width * 0.8)
        health_bar_height = 20
        health_bar_x = ui_x + (self.ui_width - health_bar_width) / 2
        health_bar_y = 40
        health_ratio = self.health / self.MAX_HEALTH
        pygame.draw.rect(self.screen, (60, 60, 80), (health_bar_x, health_bar_y, health_bar_width, health_bar_height))
        pygame.draw.rect(
            self.screen,
            (50, 200, 50),
            (health_bar_x, health_bar_y, int(health_bar_width * health_ratio), health_bar_height),
        )
        health_text = self.font_small.render(f"Health: {self.health}/{self.MAX_HEALTH}", True, self.TEXT_COLOR)
        self.screen.blit(health_text, (health_bar_x, health_bar_y - 24))

        # Score
        score_text = self.font_medium.render(f"Score: {self.score}", True, self.TEXT_COLOR)
        self.screen.blit(score_text, (ui_x + 20, 110))

        # Power‑up buttons UI
        power_y_start = 170
        power_height = 60
        power_spacing = 20
        labels = ["Reset", "Clear", "Heal"]
        for i in range(3):
            rect = pygame.Rect(
                ui_x + 20,
                power_y_start + i * (power_height + power_spacing),
                self.ui_width - 40,
                power_height,
            )
            cooldown = self.powerup_cooldowns[i]
            ratio = cooldown / self.POWERUP_COOLDOWNS[i] if self.POWERUP_COOLDOWNS[i] > 0 else 0
            # Determine colour based on cool‑down
            color_bg = (
                self.POWERUP_COOLDOWN_COLOR
                if ratio > 0
                else self.POWERUP_READY_COLOR
            )
            pygame.draw.rect(self.screen, color_bg, rect)
            # Draw overlay indicating remaining cool‑down time (a darker shade)
            if ratio > 0:
                overlay = pygame.Surface((rect.width, rect.height), pygame.SRCALPHA)
                overlay.fill((0, 0, 0, int(150 * ratio)))
                self.screen.blit(overlay, rect.topleft)
            # Label
            label_text = self.font_small.render(labels[i], True, (0, 0, 0))
            label_pos = (
                rect.x + (rect.width - label_text.get_width()) / 2,
                rect.y + (rect.height - label_text.get_height()) / 2,
            )
            self.screen.blit(label_text, label_pos)

        # Messages
        message_y = self.SCREEN_HEIGHT - 100
        for (i, (text, expiry)) in enumerate(self.messages):
            msg_surface = self.font_small.render(text, True, (220, 200, 200))
            self.screen.blit(msg_surface, (ui_x + 20, message_y + i * 24))

    def draw(self) -> None:
        """Draw the entire frame."""
        self.screen.fill(self.BACKGROUND_COLOR)
        self.draw_lanes()
        self.draw_entities()
        self.draw_ui_panel()
        pygame.display.flip()

    # -------------------------------------------------------------------------
    # Main game loop
    #
    def run(self) -> None:
        """Run the main game loop until the window is closed."""
        last_time = time.time()
        while self.running:
            # Calculate frame time
            now = time.time()
            dt = now - last_time
            last_time = now

            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    self.running = False
                elif event.type == pygame.KEYDOWN:
                    # Escape resets the game
                    if event.key == pygame.K_ESCAPE:
                        self.reset()
                    else:
                        self.handle_keydown(event.key)

            # Update the game state
            self.update(dt)
            # Draw the frame
            self.draw()
            # Cap the frame rate to 60 FPS
            self.clock.tick(60)

        pygame.quit()


def main() -> None:
    """Entry point for running the game.

    Running this script directly starts the game in windowed mode.  You can
    pass the command‑line argument '--fullscreen' to run it full screen.
    """
    full_screen = "--fullscreen" in sys.argv
    game = Game(full_screen=full_screen)
    game.run()


if __name__ == "__main__":
    main()