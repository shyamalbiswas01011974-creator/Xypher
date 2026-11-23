CXX      := g++
CXXFLAGS := -std=c++17 -O3 -Wall -Wextra -Wpedantic -Isrc
TARGET   := build/xypherd
SRCS     := src/crypto/sha256.cpp \
            src/validation.cpp \
            src/chain.cpp \
            src/market/price_engine.cpp \
            src/main.cpp

.PHONY: all clean test

all: $(TARGET)

$(TARGET): $(SRCS) src/consensus/params.h src/crypto/sha256.h src/primitives/transaction.h src/primitives/block.h src/validation.h src/chain.h src/market/price_engine.h
	@mkdir -p build
	$(CXX) $(CXXFLAGS) $(SRCS) -o $(TARGET)

test: $(TARGET)
	./$(TARGET) --cmd self-test

clean:
	rm -rf build
