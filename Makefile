registry?=exposr
node_version=18.15.0
node_image?=$(node_version)-bullseye
platforms?=linux/amd64,linux/arm64

project:=exposrd
version=$(shell [ -e build.env ] && . ./build.env 2> /dev/null && echo $${EXPOSR_BUILD_VERSION} || git describe --tags --always --dirty 2> /dev/null || git rev-parse --short HEAD)
commit=$(shell [ -e build.env ] && . ./build.env 2> /dev/null && echo $${BUILD_GIT_COMMIT} || git rev-parse --short HEAD)
package_name=$(project)-$(version).tgz
os:=$(shell uname)
ifeq (Linux, $(os))
tar_flags="--wildcards"
endif

#
# Available make targets
#
# all - Defaults to building a release tarball and a container image for the host platform.
#
# package.build - Creates release tarball
# dist.build - Build release binary for host platform
# dist.xbuild - Cross-build release binaries for supported platforms
# image.build - Build container image for host platform
# image.xbuild - Build container images for supported platforms

all: package.build.container image.build
clean: dist.clean
	docker buildx rm exposrd-builder || true
	rm -fr node_modules

get.version:
	@echo $(version)

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

dist/exposrd-$(version).tgz:
	make package.build.container

bundle.build:
	yarn install --no-default-rc --frozen-lockfile
	yarn run bundle
	yarn run bundle-es

dist.clean:
	rm -fr dist

dist.linux.build:
	@echo Building for $(dist_target)
	yarn install --no-default-rc --frozen-lockfile
	PKG_CACHE_PATH=.pkg-cache yarn run dist $(dist_platform) $(dist_target)

pkg_macos_dist?=node$(node_version)-macos-x64
dist.macos.build:
	yarn install --no-default-rc --frozen-lockfile
	PKG_CACHE_PATH=.pkg-cache yarn run dist macos-x64 $(pkg_macos_dist)

# Builder image
builder.build:
	docker build --build-arg NODE_IMAGE=$(node_image) -t $(project)-builder --target builder .

# Dist build targets
dist.build: dist/exposrd-$(version).tgz
	docker build \
		--build-arg NODE_IMAGE=$(node_image) \
		--build-arg VERSION=${version} \
		--build-arg DIST_SRC=dist/exposrd-$(version).tgz \
		--output type=tar,dest=dist/dist-build-$(version).tar \
		--target distbuild \
		.
	tar xf dist/dist-build-$(version).tar $(tar_flags) "dist/exposrd-$(version)-*"
	rm dist/dist-build-$(version).tar

dist.xbuild:
	docker buildx create --name exposrd-builder --driver docker-container || true
	docker buildx build \
		--builder exposrd-builder \
		--platform $(platforms) \
		--target distbuild \
		--output type=tar,dest=dist/dist-build-$(version).tar \
		--progress=plain \
		--build-arg NODE_IMAGE=$(node_image) \
		--build-arg VERSION=${version} \
		--build-arg DIST_SRC=dist/exposrd-$(version).tgz \
		--label "org.opencontainers.image.version=$(version)" \
		--label "org.opencontainers.image.revision=$(shell git rev-parse HEAD)" \
		--label "org.opencontainers.image.description=exposrd version $(version) commit $(shell git rev-parse HEAD)" \
		.
	tar xf dist/dist-build-$(version).tar --strip 1 $(tar_flags) "*/dist/exposrd-$(version)-*"
	rm dist/dist-build-$(version).tar

# Docker image build targets
image.build:
	docker build \
		--build-arg NODE_IMAGE=$(node_image) \
		--build-arg VERSION=${version} \
		--build-arg DIST_SRC=dist/exposrd-$(version).tgz \
		--target imagebuild \
		--pull -t $(project):$(version) .

get.image:
	@echo $(project):$(version)

ifneq (, $(publish))
push_flag=--push
endif

image.xbuild:
	docker buildx create --name exposrd-builder --driver docker-container || true
	docker buildx build \
		--builder exposrd-builder \
		--platform $(platforms) \
		--target imagebuild \
		$(push_flag) \
		--build-arg NODE_IMAGE=$(node_image) \
		--build-arg VERSION=${version} \
		--build-arg DIST_SRC=dist/exposrd-$(version).tgz \
		-t $(registry)/$(project):$(version) .

image.xbuild.latest:
	docker buildx imagetools create --tag $(registry)/$(project):latest $(registry)/$(project):$(version)

image.xbuild.unstable:
	docker buildx imagetools create --tag $(registry)/$(project):unstable $(registry)/$(project):$(version)

nodist.image.build: dist/exposrd-$(version).tgz
	docker build \
		-f Dockerfile.nodist \
		--progress plain \
		--build-arg VERSION=${version} \
		--build-arg DIST_SRC=dist/exposrd-$(version).tgz \
		--label "org.opencontainers.image.source=https://github.com/exposr/exposrd" \
		--label "org.opencontainers.image.version=$(version)" \
		--label "org.opencontainers.image.revision=$(commit)" \
		--label "org.opencontainers.image.description=exposrd version $(version) commit $(commit)" \
		-t $(project):nodist-$(version) \
		.

nodist.image.xbuild: dist/exposrd-$(version).tgz
	docker buildx create --name exposrd-builder --driver docker-container || true
	docker buildx build \
		--builder exposrd-builder \
		-f Dockerfile.nodist \
		--progress plain \
		--platform $(platforms) \
		$(push_flag) \
		--build-arg VERSION=${version} \
		--build-arg DIST_SRC=dist/exposrd-$(version).tgz \
		--label "org.opencontainers.image.source=https://github.com/exposr/exposrd" \
		--label "org.opencontainers.image.version=$(version)" \
		--label "org.opencontainers.image.revision=$(commit)" \
		--label "org.opencontainers.image.description=exposrd version $(version) commit $(commit)" \
		-t $(project):nodist-$(version) \
		.

nodist.image.xbuild.unstable:
	docker buildx imagetools create --tag $(registry)/$(project)-nodist:unstable $(registry)/$(project):nodist-$(version)


.PHONY: release release.publish builder.build image.build image.xbuild image.xbuild.latest image.xbuild.unstable