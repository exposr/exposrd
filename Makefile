registry?=exposr
node_version=18.5.0
node_image?=$(node_version)-alpine3.16
platforms?=linux/amd64,linux/arm64,linux/arm/v7
# Available build targets https://github.com/vercel/pkg-fetch
pkg_linux_dist?=node$(node_version)-linuxstatic-arm64,node$(node_version)-linuxstatic-armv7,node$(node_version)-linuxstatic-x64
pkg_macos_dist?=node$(node_version)-macos-x64

project:=exposr-server
version=$(shell [ -e build.env ] && . ./build.env 2> /dev/null && echo $${EXPOSR_BUILD_VERSION} || git describe --tags --always --dirty 2> /dev/null || git rev-parse --short HEAD)
package_name=$(project)-$(version).tgz

all: package.build.container bundle.build.container dist.linux.build.container image.build
clean: dist.clean
	rm -fr node_modules

define docker.run
	docker run --rm -i \
		-u $(shell id -u):$(shell id -g) \
		-v ${PWD}:/workdir \
		$(project)-builder \
		$1 $2 $3 $4 $5 $6 $7 $8 $9
endef

# Wraps any call and runs inside builder container
%.container: builder.build
	$(call docker.run, "make $(subst .container,,$@)")

package.build:
	yarn install --no-default-rc --frozen-lockfile
	mkdir -p dist
	yarn pack --no-default-rc --frozen-lockfile --filename dist/$(package_name)

bundle.build:
	yarn install --no-default-rc --frozen-lockfile
	yarn run bundle

dist.clean:
	rm -fr dist

dist.linux.build:
	yarn install --no-default-rc --frozen-lockfile
	PKG_CACHE_PATH=.pkg-cache yarn run dist $(pkg_linux_dist)

dist.macos.build:
	yarn install --no-default-rc --frozen-lockfile
	PKG_CACHE_PATH=.pkg-cache yarn run dist $(pkg_macos_dist)

# Builder image
builder.build:
	docker build --build-arg NODE_IMAGE=$(node_image) -t $(project)-builder --target builder .

# Docker package
image.build:
	docker build \
		--build-arg NODE_IMAGE=$(node_image) \
		--build-arg VERSION=${version} \
		--pull -t $(project):$(version) .

ifneq (, $(publish))
push_flag=--push
endif
image.buildx:
	docker buildx create --name exposr-server-builder --driver docker-container || true
	docker buildx build \
		--builder exposr-server-builder \
		--platform $(platforms) \
		$(push_flag) \
		--build-arg NODE_IMAGE=$(node_image) \
		--build-arg VERSION=${version} \
		-t $(registry)/$(project):$(version) .
	docker buildx rm exposr-server-builder

image.buildx.latest:
	docker buildx imagetools create --tag $(registry)/$(project):latest $(registry)/$(project):$(version)

image.buildx.unstable:
	docker buildx imagetools create --tag $(registry)/$(project):unstable $(registry)/$(project):$(version)

.PHONY: release release.publish builder.build image.build image.buildx image.buildx.latest image.buildx.unstable
