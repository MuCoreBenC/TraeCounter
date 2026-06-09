package main

import (
	"embed"

	"trae-counter/internal/version"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:     "Trae 对话计数",
		Width:     520,
		Height:    390,
		MinWidth:  400,
		MinHeight: 300,
		MaxWidth:  720,
		MaxHeight: 540,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour:  &options.RGBA{R: 232, G: 236, B: 239, A: 255},
		OnStartup:         app.startup,
		OnShutdown:        app.shutdown,
		HideWindowOnClose: true,
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "com.trae-counter",
		},
		Mac: &mac.Options{
			TitleBar: mac.TitleBarHiddenInset(),
			About: &mac.AboutInfo{
				Title:   "Trae 对话计数",
				Message: "版本 " + version.Get() + "\n\n追踪每日 Trae IDE 对话消息数量\n支持多用户统计、额度提醒、Touch Bar 显示\n\n© 2026 Trae 对话计数 Contributors\nCC BY-NC 4.0",
			},
			WebviewIsTransparent: false,
			WindowIsTranslucent:  true,
		},
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
