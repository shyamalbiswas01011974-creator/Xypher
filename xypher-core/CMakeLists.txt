cmake_minimum_required(VERSION 3.16)
project(xypher_core VERSION 2.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(xypherd
    src/crypto/sha256.cpp
    src/validation.cpp
    src/chain.cpp
    src/market/price_engine.cpp
    src/main.cpp
)

target_include_directories(xypherd PRIVATE src)
target_compile_options(xypherd PRIVATE -O3 -Wall -Wextra -Wpedantic)
