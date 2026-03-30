export interface UIColors {
  bgPrimary: string
  bgSecondary: string
  bgTertiary: string
  textPrimary: string
  textSecondary: string
  accent: string
  success: string
  error: string
  border: string
}

export interface TerminalColors {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export interface ThemeConfig {
  ui: UIColors
  terminal: TerminalColors
}

export interface ThemePreset {
  name: string
  slug: string
  theme: ThemeConfig
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    name: 'Tokyonight',
    slug: 'tokyonight',
    theme: {
      ui: {
        bgPrimary: '#1a1b26',
        bgSecondary: '#24283b',
        bgTertiary: '#414868',
        textPrimary: '#a9b1d6',
        textSecondary: '#565f89',
        accent: '#7aa2f7',
        success: '#9ece6a',
        error: '#f7768e',
        border: '#2f3549'
      },
      terminal: {
        background: '#1a1b26',
        foreground: '#a9b1d6',
        cursor: '#a9b1d6',
        selectionBackground: '#414868',
        black: '#15161e',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#bb9af7',
        cyan: '#7dcfff',
        white: '#a9b1d6',
        brightBlack: '#414868',
        brightRed: '#f7768e',
        brightGreen: '#9ece6a',
        brightYellow: '#e0af68',
        brightBlue: '#7aa2f7',
        brightMagenta: '#bb9af7',
        brightCyan: '#7dcfff',
        brightWhite: '#c0caf5'
      }
    }
  },
  {
    name: 'Dracula',
    slug: 'dracula',
    theme: {
      ui: {
        bgPrimary: '#282a36',
        bgSecondary: '#343746',
        bgTertiary: '#44475a',
        textPrimary: '#f8f8f2',
        textSecondary: '#6272a4',
        accent: '#bd93f9',
        success: '#50fa7b',
        error: '#ff5555',
        border: '#44475a'
      },
      terminal: {
        background: '#282a36',
        foreground: '#f8f8f2',
        cursor: '#f8f8f2',
        selectionBackground: '#44475a',
        black: '#21222c',
        red: '#ff5555',
        green: '#50fa7b',
        yellow: '#f1fa8c',
        blue: '#bd93f9',
        magenta: '#ff79c6',
        cyan: '#8be9fd',
        white: '#f8f8f2',
        brightBlack: '#6272a4',
        brightRed: '#ff6e6e',
        brightGreen: '#69ff94',
        brightYellow: '#ffffa5',
        brightBlue: '#d6acff',
        brightMagenta: '#ff92df',
        brightCyan: '#a4ffff',
        brightWhite: '#ffffff'
      }
    }
  },
  {
    name: 'Catppuccin Mocha',
    slug: 'catppuccin-mocha',
    theme: {
      ui: {
        bgPrimary: '#1e1e2e',
        bgSecondary: '#313244',
        bgTertiary: '#45475a',
        textPrimary: '#cdd6f4',
        textSecondary: '#6c7086',
        accent: '#89b4fa',
        success: '#a6e3a1',
        error: '#f38ba8',
        border: '#313244'
      },
      terminal: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#45475a',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#cba6f7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#cba6f7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8'
      }
    }
  },
  {
    name: 'Nord',
    slug: 'nord',
    theme: {
      ui: {
        bgPrimary: '#2e3440',
        bgSecondary: '#3b4252',
        bgTertiary: '#434c5e',
        textPrimary: '#eceff4',
        textSecondary: '#7b88a1',
        accent: '#88c0d0',
        success: '#a3be8c',
        error: '#bf616a',
        border: '#3b4252'
      },
      terminal: {
        background: '#2e3440',
        foreground: '#d8dee9',
        cursor: '#d8dee9',
        selectionBackground: '#434c5e',
        black: '#3b4252',
        red: '#bf616a',
        green: '#a3be8c',
        yellow: '#ebcb8b',
        blue: '#81a1c1',
        magenta: '#b48ead',
        cyan: '#88c0d0',
        white: '#e5e9f0',
        brightBlack: '#4c566a',
        brightRed: '#bf616a',
        brightGreen: '#a3be8c',
        brightYellow: '#ebcb8b',
        brightBlue: '#81a1c1',
        brightMagenta: '#b48ead',
        brightCyan: '#8fbcbb',
        brightWhite: '#eceff4'
      }
    }
  },
  {
    name: 'Gruvbox Dark',
    slug: 'gruvbox-dark',
    theme: {
      ui: {
        bgPrimary: '#282828',
        bgSecondary: '#3c3836',
        bgTertiary: '#504945',
        textPrimary: '#ebdbb2',
        textSecondary: '#928374',
        accent: '#83a598',
        success: '#b8bb26',
        error: '#fb4934',
        border: '#3c3836'
      },
      terminal: {
        background: '#282828',
        foreground: '#ebdbb2',
        cursor: '#ebdbb2',
        selectionBackground: '#504945',
        black: '#282828',
        red: '#cc241d',
        green: '#98971a',
        yellow: '#d79921',
        blue: '#458588',
        magenta: '#b16286',
        cyan: '#689d6a',
        white: '#a89984',
        brightBlack: '#928374',
        brightRed: '#fb4934',
        brightGreen: '#b8bb26',
        brightYellow: '#fabd2f',
        brightBlue: '#83a598',
        brightMagenta: '#d3869b',
        brightCyan: '#8ec07c',
        brightWhite: '#ebdbb2'
      }
    }
  },
  {
    name: 'One Dark',
    slug: 'one-dark',
    theme: {
      ui: {
        bgPrimary: '#282c34',
        bgSecondary: '#21252b',
        bgTertiary: '#2c313a',
        textPrimary: '#abb2bf',
        textSecondary: '#5c6370',
        accent: '#61afef',
        success: '#98c379',
        error: '#e06c75',
        border: '#3e4451'
      },
      terminal: {
        background: '#282c34',
        foreground: '#abb2bf',
        cursor: '#528bff',
        selectionBackground: '#3e4451',
        black: '#282c34',
        red: '#e06c75',
        green: '#98c379',
        yellow: '#e5c07b',
        blue: '#61afef',
        magenta: '#c678dd',
        cyan: '#56b6c2',
        white: '#abb2bf',
        brightBlack: '#5c6370',
        brightRed: '#e06c75',
        brightGreen: '#98c379',
        brightYellow: '#e5c07b',
        brightBlue: '#61afef',
        brightMagenta: '#c678dd',
        brightCyan: '#56b6c2',
        brightWhite: '#ffffff'
      }
    }
  },
  {
    name: 'Solarized Dark',
    slug: 'solarized-dark',
    theme: {
      ui: {
        bgPrimary: '#002b36',
        bgSecondary: '#073642',
        bgTertiary: '#586e75',
        textPrimary: '#839496',
        textSecondary: '#657b83',
        accent: '#268bd2',
        success: '#859900',
        error: '#dc322f',
        border: '#073642'
      },
      terminal: {
        background: '#002b36',
        foreground: '#839496',
        cursor: '#839496',
        selectionBackground: '#073642',
        black: '#073642',
        red: '#dc322f',
        green: '#859900',
        yellow: '#b58900',
        blue: '#268bd2',
        magenta: '#d33682',
        cyan: '#2aa198',
        white: '#eee8d5',
        brightBlack: '#586e75',
        brightRed: '#cb4b16',
        brightGreen: '#586e75',
        brightYellow: '#657b83',
        brightBlue: '#839496',
        brightMagenta: '#6c71c4',
        brightCyan: '#93a1a1',
        brightWhite: '#fdf6e3'
      }
    }
  },
  {
    name: 'Tokyonight Light',
    slug: 'tokyonight-light',
    theme: {
      ui: {
        bgPrimary: '#d5d6db',
        bgSecondary: '#e1e2e7',
        bgTertiary: '#c4c5cb',
        textPrimary: '#343b58',
        textSecondary: '#6172b0',
        accent: '#2e7de9',
        success: '#587539',
        error: '#f52a65',
        border: '#c4c8da'
      },
      terminal: {
        background: '#d5d6db',
        foreground: '#343b58',
        cursor: '#343b58',
        selectionBackground: '#c4c8da',
        black: '#0f0f14',
        red: '#f52a65',
        green: '#587539',
        yellow: '#8c6c3e',
        blue: '#2e7de9',
        magenta: '#9854f1',
        cyan: '#007197',
        white: '#6172b0',
        brightBlack: '#a1a6c5',
        brightRed: '#f52a65',
        brightGreen: '#587539',
        brightYellow: '#8c6c3e',
        brightBlue: '#2e7de9',
        brightMagenta: '#9854f1',
        brightCyan: '#007197',
        brightWhite: '#343b58'
      }
    }
  },
  {
    name: 'Catppuccin Latte',
    slug: 'catppuccin-latte',
    theme: {
      ui: {
        bgPrimary: '#eff1f5',
        bgSecondary: '#e6e9ef',
        bgTertiary: '#ccd0da',
        textPrimary: '#4c4f69',
        textSecondary: '#8c8fa1',
        accent: '#1e66f5',
        success: '#40a02b',
        error: '#d20f39',
        border: '#ccd0da'
      },
      terminal: {
        background: '#eff1f5',
        foreground: '#4c4f69',
        cursor: '#dc8a78',
        selectionBackground: '#ccd0da',
        black: '#5c5f77',
        red: '#d20f39',
        green: '#40a02b',
        yellow: '#df8e1d',
        blue: '#1e66f5',
        magenta: '#8839ef',
        cyan: '#179299',
        white: '#acb0be',
        brightBlack: '#6c6f85',
        brightRed: '#d20f39',
        brightGreen: '#40a02b',
        brightYellow: '#df8e1d',
        brightBlue: '#1e66f5',
        brightMagenta: '#8839ef',
        brightCyan: '#179299',
        brightWhite: '#bcc0cc'
      }
    }
  },
  {
    name: 'Nord Light',
    slug: 'nord-light',
    theme: {
      ui: {
        bgPrimary: '#eceff4',
        bgSecondary: '#e5e9f0',
        bgTertiary: '#d8dee9',
        textPrimary: '#2e3440',
        textSecondary: '#4c566a',
        accent: '#5e81ac',
        success: '#a3be8c',
        error: '#bf616a',
        border: '#d8dee9'
      },
      terminal: {
        background: '#eceff4',
        foreground: '#2e3440',
        cursor: '#2e3440',
        selectionBackground: '#d8dee9',
        black: '#3b4252',
        red: '#bf616a',
        green: '#a3be8c',
        yellow: '#ebcb8b',
        blue: '#81a1c1',
        magenta: '#b48ead',
        cyan: '#88c0d0',
        white: '#e5e9f0',
        brightBlack: '#4c566a',
        brightRed: '#bf616a',
        brightGreen: '#a3be8c',
        brightYellow: '#ebcb8b',
        brightBlue: '#81a1c1',
        brightMagenta: '#b48ead',
        brightCyan: '#8fbcbb',
        brightWhite: '#eceff4'
      }
    }
  },
  {
    name: 'Solarized Light',
    slug: 'solarized-light',
    theme: {
      ui: {
        bgPrimary: '#fdf6e3',
        bgSecondary: '#eee8d5',
        bgTertiary: '#d6cdb7',
        textPrimary: '#657b83',
        textSecondary: '#93a1a1',
        accent: '#268bd2',
        success: '#859900',
        error: '#dc322f',
        border: '#eee8d5'
      },
      terminal: {
        background: '#fdf6e3',
        foreground: '#657b83',
        cursor: '#657b83',
        selectionBackground: '#eee8d5',
        black: '#073642',
        red: '#dc322f',
        green: '#859900',
        yellow: '#b58900',
        blue: '#268bd2',
        magenta: '#d33682',
        cyan: '#2aa198',
        white: '#eee8d5',
        brightBlack: '#586e75',
        brightRed: '#cb4b16',
        brightGreen: '#586e75',
        brightYellow: '#657b83',
        brightBlue: '#839496',
        brightMagenta: '#6c71c4',
        brightCyan: '#93a1a1',
        brightWhite: '#fdf6e3'
      }
    }
  },
  {
    name: 'GitHub Light',
    slug: 'github-light',
    theme: {
      ui: {
        bgPrimary: '#ffffff',
        bgSecondary: '#f6f8fa',
        bgTertiary: '#d0d7de',
        textPrimary: '#1f2328',
        textSecondary: '#656d76',
        accent: '#0969da',
        success: '#1a7f37',
        error: '#cf222e',
        border: '#d0d7de'
      },
      terminal: {
        background: '#ffffff',
        foreground: '#1f2328',
        cursor: '#044289',
        selectionBackground: '#ddf4ff',
        black: '#24292f',
        red: '#cf222e',
        green: '#1a7f37',
        yellow: '#9a6700',
        blue: '#0969da',
        magenta: '#8250df',
        cyan: '#1b7c83',
        white: '#6e7781',
        brightBlack: '#57606a',
        brightRed: '#a40e26',
        brightGreen: '#2da44e',
        brightYellow: '#bf8700',
        brightBlue: '#218bff',
        brightMagenta: '#a475f9',
        brightCyan: '#3192aa',
        brightWhite: '#8c959f'
      }
    }
  }
]

export const DEFAULT_THEME: ThemeConfig = THEME_PRESETS[0].theme
