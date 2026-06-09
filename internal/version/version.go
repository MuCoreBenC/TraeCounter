package version

// Version is set at build time via -ldflags "-X trae-counter/internal/version.Version=x.x.x"
// If not set, it defaults to "dev"
var Version = "dev"

// Get returns the application version
func Get() string {
	return Version
}
